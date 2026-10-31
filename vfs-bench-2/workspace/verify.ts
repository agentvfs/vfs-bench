/** Native Mirage verifier. Input transport contains bytes and JSON, never host paths. */
import { CLI, CLIHandler } from '@struktoai/mirage-core/commands/cli/types'
import { CommandSpec } from '@struktoai/mirage-core/commands/spec/types'
import { IOResult } from '@struktoai/mirage-core/io/types'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'
import { type Inputs, type InputSpec, type Grade, type Graders } from './grader.ts'
export type VerifyRequest = Inputs
/** A dataset's graders: `datasets/<dataset>/graders/index.ts`. */
async function graders(dataset: string): Promise<Graders> {
  if (!/^[a-z0-9]+$/.test(dataset)) throw new Error(`Invalid dataset: ${dataset}`)
  return (await import(new URL(`../datasets/${dataset}/graders/index.ts`, import.meta.url).href)) as Graders
}
const encoder = new TextEncoder()
function pathSpec(path: string) {
  if (!path.startsWith('/') || path.split('/').some((s) => s === '.' || s === '..') || path.includes('\0'))
    throw new Error(`Invalid virtual input path: ${path}`)
  return new PathSpec({ virtual: path, directory: '/', vfsPath: path.slice(1) })
}
export async function verifierWorkspace(
  request: VerifyRequest
): Promise<{ workspace: Workspace; result: () => Grade | undefined }> {
  const { GRADERS, evaluate } = await graders(request.dataset)
  if (!Object.hasOwn(GRADERS, request.task)) throw new Error(`No Mirage grader for ${request.task}`)
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0)
    throw new Error('Invalid verifier timeout')
  const input = new RAMVFS(),
    output = new RAMVFS()
  const write = async (path: string, data: Uint8Array) => {
    await input.mkdir(pathSpec(path.slice(0, path.lastIndexOf('/')) || '/'), true)
    await input.write(pathSpec(path), data)
  }
  const { states, files = {}, ...metadata } = request
  const spec: InputSpec = { ...metadata, states: {}, files: Object.keys(files) }
  for (const [i, [alias, tables]] of Object.entries(states).entries()) {
    const path = `/.verifier-state/${i}.json`
    spec.states[alias] = path
    await write(path, encoder.encode(JSON.stringify(tables)))
  }
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith('/.verifier-state/') || path.startsWith('/logs/verifier/reward'))
      throw new Error(`Reserved verifier path: ${path}`)
    await write(
      path,
      Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))
    )
  }
  let grade: Grade | undefined
  const workspace = new Workspace(
    { '/': [input, MountMode.READ], '/.verifier-output': [output, MountMode.WRITE] },
    {
      runtimes: ['workspace'],
      commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) },
    }
  )
  workspace.registerCli(
    'grade',
    new CLI({
      spec: new CommandSpec({ name: 'grade', description: 'Grade the frozen Mirage VFS state.' }),
      handlers: {
        '': new CLIHandler({
          fn: async (_accessor, _paths, _texts, command) => {
            grade = await evaluate(spec, command)
            return [encoder.encode(`${grade.score}\n`), new IOResult()]
          },
        }),
      },
    })
  )
  return { workspace, result: () => grade }
}
export async function verify(request: VerifyRequest) {
  const started = performance.now()
  const { workspace, result } = await verifierWorkspace(request)
  try {
    const io = await workspace.shell(
      'grade > /.verifier-output/reward.txt && cat /.verifier-output/reward.txt'
    )
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
    let text = ''
    for await (const chunk of process.stdin) text += chunk.toString('utf8')
    process.stdout.write(`${JSON.stringify(await verify(JSON.parse(text)))}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  }
}
