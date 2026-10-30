/**
 * A trusted grader command in a fresh Mirage workspace, with no language
 * runtime. Called by MirageVerifier in a disposable Node process so Harbor
 * can kill synchronous work on timeout/cancel. Never loads task-provided code.
 */
import { readFileSync } from 'node:fs'

// Import the virtual shell directly: the broad Node entrypoint also loads
// every cloud/storage adapter and host runtime, which grading doesn't need.
import { CLI, CLIHandler } from '@struktoai/mirage-core/commands/cli/types'
import { CommandSpec } from '@struktoai/mirage-core/commands/spec/types'
import { IOResult } from '@struktoai/mirage-core/io/types'
import { Limit, MountMode } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'

import { type Inputs, type Grade } from './graders/context.ts'
import { evaluate, GRADERS } from './graders/index.ts'

export type VerifyRequest = Inputs

/** Only registered, reviewed graders can reach the staged database. No SQL/path arguments. */
export function verifierWorkspace(request: VerifyRequest): {
  workspace: Workspace
  result: () => Grade | undefined
} {
  if (!Object.hasOwn(GRADERS, request.task)) throw new Error(`No Mirage grader for ${request.task}`)
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0)
    throw new Error('Invalid verifier timeout')
  let grade: Grade | undefined
  const workspace = new Workspace(
    { '/logs/verifier': new RAMVFS() },
    {
      mode: MountMode.WRITE,
      runtimes: ['workspace'],
      commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) },
    }
  )
  workspace.registerCli(
    'grade',
    new CLI({
      spec: new CommandSpec({ name: 'grade', description: 'Grade this trial using its frozen state.' }),
      handlers: {
        '': new CLIHandler({
          fn: () => {
            // Real SQLite, opened read-only. Its path is fixed by the host's
            // staging, never taken from an agent command or task environment.
            grade = evaluate(request)
            return [new TextEncoder().encode(`${grade.score}\n`), new IOResult()]
          },
        }),
      },
    })
  )
  return { workspace, result: () => grade }
}

export async function verify(request: VerifyRequest) {
  const started = performance.now()
  const { workspace, result } = verifierWorkspace(request)
  try {
    const io = await workspace.shell('grade > /logs/verifier/reward.txt && cat /logs/verifier/reward.txt')
    if (io.exitCode !== 0) throw new Error(`Grader failed (${io.exitCode}): ${io.stderrText}`)
    const grade = result()
    if (!grade || Number(io.stdoutText.trim()) !== grade.score)
      throw new Error('Grader did not write its reward')
    return {
      ...grade,
      stdout: `Score: ${Number.isInteger(grade.score) ? grade.score.toFixed(1) : grade.score}/1.0\n`,
      timings: {
        run_s: (performance.now() - started) / 1000,
        peak_node_mib: process.resourceUsage().maxRSS / 1024,
      },
    }
  } finally {
    await workspace.close()
  }
}

if (import.meta.main) {
  try {
    const request = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as VerifyRequest
    process.stdout.write(`${JSON.stringify(await verify(request))}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  }
}
