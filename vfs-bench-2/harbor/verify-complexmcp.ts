/** ComplexMCP grading: frozen JSON -> Mirage shell -> Monty 1.4.0 -> RAM rewards. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MontyRuntime } from '@struktoai/mirage-core/runtime/python/monty/runtime'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'
import { quote } from './graders/context.ts'

const directory = new URL('./graders/complexmcp/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const reference = readFileSync(new URL('reference/judge.py', directory), 'utf8')
if (createHash('sha256').update(reference).digest('hex') !== manifest.reference['judge.py'])
  throw new Error('ComplexMCP reference judge changed; verify parity before updating its pin')
// Preserve the upstream judge body. Only its third-party import is replaced;
// the upstream demo below __main__ is not part of grading.
const program = [
  readFileSync(new URL('levenshtein.py', directory), 'utf8'),
  reference.replace('from software.utils.dist import lev_sim\n', '').split('if __name__ == "__main__":')[0],
  readFileSync(new URL('main.py', directory), 'utf8'),
].join('\n')

export interface ComplexRequest {
  task: string
  files: Record<string, string>
  timeoutSeconds: number
}
const path = (name: string) => new PathSpec({ virtual: '/' + name, directory: '/', vfsPath: name })

export async function verifyComplex(request: ComplexRequest) {
  if (!Object.hasOwn(manifest.tasks, request.task)) throw new Error('Unregistered ComplexMCP task')
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0)
    throw new Error('Invalid verifier timeout')
  if (Object.keys(request.files).join() !== '/input/state.json') throw new Error('Invalid frozen inputs')
  const started = performance.now()
  const input = new RAMVFS(),
    output = new RAMVFS()
  // Keep JSON as bytes through Node: large Python integer IDs must not become JS doubles.
  await input.write(path('state.json'), Buffer.from(request.files['/input/state.json'], 'base64'))
  const runtime = new MontyRuntime({ config: { maxMemory: 128 * 1024 * 1024 } })
  runtime.shared = false
  const workspace = new Workspace(
    {
      '/': [new RAMVFS(), MountMode.EXEC],
      '/input': [input, MountMode.READ],
      '/output': [output, MountMode.WRITE],
    },
    {
      runtimes: [runtime, 'workspace'],
      commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) },
    }
  )
  try {
    const result = await workspace.shell('python -c ' + quote(program))
    if (result.exitCode !== 0)
      throw new Error(`Monty grader failed (${result.exitCode}): ${result.stderrText}`)
    const reward = await workspace.shell('cat /output/reward.json')
    if (reward.exitCode !== 0) throw new Error('Monty grader did not write its reward')
    const rewards = JSON.parse(reward.stdoutText)
    if (
      Object.keys(rewards).sort().join() !== 'misbehave,recall,reward,total' ||
      !Object.values(rewards).every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) ||
      ![0, 1].includes(rewards.reward) ||
      rewards.recall > rewards.total
    )
      throw new Error('Invalid Monty rewards')
    return {
      score: rewards.reward,
      rewards,
      checks: { ...rewards },
      stdout: result.stdoutText,
      artifacts: { 'judge.log': result.stdoutText },
      timings: {
        run_s: (performance.now() - started) / 1000,
        peak_node_mib: process.resourceUsage().maxRSS / 1024,
      },
    }
  } finally {
    await workspace.close()
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  console.log(JSON.stringify(await verifyComplex(JSON.parse(input))))
}
