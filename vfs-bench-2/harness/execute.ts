/**
 * Run one task: fakes up, seeded, something acting in the workspace, graded.
 *
 * Every run starts its own fakes, seeds them, snapshots them, lets `act`
 * work in the workspace, snapshots them again and grades the difference.
 * There is no way to skip the seed or the grade: a run graded against a
 * previous run's state, or not graded, measures nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Workspace } from '@struktoai/mirage-node'
import { buildSystemPrompt } from '@struktoai/mirage-openai-agents'

import * as dump from './dump.ts'
import { start } from './fakes.ts'
import { ROOT } from './paths.ts'
import { Run } from './runs.ts'
import type { Graded, Task } from './task.ts'
import { openWorkspace } from './workspace.ts'

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
  try {
    for (const spec of task.fakes(run)) await start(spec, run)
    const seeded = await task.seed(run)
    const before = await task.snapshot(run)
    const workspace = await openWorkspace(join(task.dir, 'workspace.yaml'), run.env)
    try {
      for (const { name, cli, config } of (await task.clis?.(run)) ?? []) workspace.registerCli(name, cli, config)
      const skills = await workspace.skillMd()
      instructions = await buildSystemPrompt({
        workspace,
        extraInstructions: task.instructions === undefined ? skills : task.instructions(skills),
      })
      outcome = await act(workspace, instructions, task.instruction)
    } finally {
      await workspace.close()
    }
    const after = await task.snapshot(run)
    if (existsSync(run.answerPath)) answer = JSON.parse(readFileSync(run.answerPath, 'utf8'))
    grade = await task.grade({ run, before, after, seeded, answer })
  } finally {
    for (const fake of run.fakes.values()) writeFileSync(join(run.dir, `${fake.name}.log`), fake.log.join('\n'))
    await run.stop()
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
    instructions,
    task_instruction: task.instruction,
    ...outcome,
  }
  return { ...record, dump: dump.write(record) }
}
