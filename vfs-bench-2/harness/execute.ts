/**
 * Run one task: fakes up, seeded, something acting in the workspace, graded.
 *
 * Every run starts its own fakes, seeds them, snapshots them, lets `act`
 * work in the workspace, snapshots them again and grades the difference.
 * There is no way to skip the seed or the grade: a run graded against a
 * previous run's state, or not graded, measures nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { constants } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Workspace } from '@struktoai/mirage-node'
import { buildSystemPrompt } from '@struktoai/mirage-openai-agents'

import { type Change, changes } from './diff.ts'
import * as dump from './dump.ts'
import { start } from './fakes.ts'
import { ROOT } from './paths.ts'
import { Run } from './runs.ts'
import { type Graded, type Task, graded } from './task.ts'
import { openWorkspace } from './workspace.ts'

// Every run is in UTC, whatever the host's zone, as upstream's containers
// are: the workspace's `date` and python3, and the fakes, which inherit it.
process.env.TZ = 'UTC'

/** What `act` returns: the run record's agent fields. */
export interface Outcome {
  status: string
  error: string | null
  final_output: string | null
  usage: Record<string, number>
  items: unknown[]
}

/** What happens in the workspace, given it, the system prompt and the instruction. */
export type Act = (workspace: Workspace, instructions: string, instruction: string) => Promise<Outcome>

/** `<dataset>/<task>` to the dataset's task. */
export async function loadTask(ref: string): Promise<{ dataset: string; task: Task }> {
  const [dataset, slug] = ref.split('/')
  if (dataset === undefined || slug === undefined) throw new Error(`expected <dataset>/<task>, got '${ref}'`)
  const module = (await import(pathToFileURL(join(ROOT, dataset, 'index.ts')).href)) as {
    load(slug: string): Promise<Task>
  }
  return { dataset, task: await module.load(slug) }
}

/** Seed, act, grade and dump one run. */
export async function execute(ref: string, act: Act, info: Record<string, unknown> = {}) {
  const { dataset, task } = await loadTask(ref)
  const run = Run.create(dataset, task.slug)
  const started = new Date().toISOString()
  let instructions = ''
  let outcome: Outcome
  let answer: unknown = null
  let grade: Graded
  let gradeError: string | null = null
  // What the agent changed, from the seeded snapshot to the last one.
  let changed: Change[] | null = null
  // Stop the fakes and save their logs, once, when the run ends or the
  // process is told to stop.
  let stopping: Promise<void> | undefined
  const stop = () =>
    (stopping ??= (async () => {
      try {
        await run.stop()
      } finally {
        // After stopping, so what a fake prints on its way down is kept.
        for (const fake of run.fakes.values()) writeFileSync(join(run.dir, `${fake.name}.log`), fake.log.join('\n'))
      }
    })())
  // A signal ends Node without running `finally`, which would leave the
  // fakes' processes and containers running. `on`, not `once`: the agents
  // SDK exits on SIGTERM itself unless another listener is still there.
  const onSignal = (signal: NodeJS.Signals) => {
    void stop().finally(() => process.exit(128 + constants.signals[signal]))
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    for (const spec of task.fakes(run)) await start(spec, run)
    const seeded = await task.seed(run)
    const before = await task.snapshot(run)
    const workspace = await openWorkspace(join(task.dir, 'workspace.yaml'), run.env)
    try {
      for (const { name, cli, config } of (await task.clis?.(run)) ?? []) workspace.registerCli(name, cli, config)
      for (const line of task.shellInit?.(run) ?? []) {
        const io = await workspace.shell(line, { record: false })
        if (io.exitCode !== 0) throw new Error(`shell init '${line}' exited ${io.exitCode}: ${io.stderrText}`)
      }
      const skills = await workspace.skillMd()
      instructions = await buildSystemPrompt({
        workspace,
        extraInstructions: task.instructions === undefined ? skills : task.instructions(skills),
      })
      outcome = await act(workspace, instructions, task.instruction)
    } finally {
      await workspace.close()
    }
    // A grader that throws fails the run but keeps the agent's trace.
    try {
      const after = await task.snapshot(run)
      changed = changes(before, after)
      if (existsSync(run.answerPath)) answer = JSON.parse(readFileSync(run.answerPath, 'utf8'))
      grade = await task.grade({ run, before, after, seeded, answer })
    } catch (error) {
      gradeError = (error as Error).stack ?? String(error)
      grade = graded([{ name: 'the grader ran', passed: false, detail: gradeError }])
    }
  } finally {
    await stop()
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  const record = {
    run_id: run.id,
    dataset,
    task: task.slug,
    ...info,
    mirage: dump.mirageCommit(),
    started,
    ended: new Date().toISOString(),
    answer,
    passed: grade.passed,
    checks: grade.checks,
    grade_error: gradeError,
    changes: changed,
    instructions,
    task_instruction: task.instruction,
    ...outcome,
  }
  return { ...record, dump: dump.write(record) }
}
