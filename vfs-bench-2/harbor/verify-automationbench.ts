/** AutomationBench: frozen fake JSON -> separate Mirage VFS -> Monty 1.4.0. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MontyRuntime } from '@struktoai/mirage-core/runtime/python/monty/runtime'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'

const directory = new URL('./graders/automationbench/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const source = (name: string) => readFileSync(new URL(name, directory), 'utf8')
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const port = source('port.py'),
  models = source('models.json')
if (sha256(port) !== manifest.port_sha256 || sha256(models) !== manifest.models_sha256)
  throw new Error('AutomationBench port/schema changed; regenerate and verify parity')
const program = [
  source('model_runtime.py'),
  'MODELS = json.loads(Path("/input/models.json").read_text())',
  port,
  source('main.py'),
].join('\n')

export interface AutomationRequest {
  task: string
  files: Record<string, string>
  timeoutSeconds: number
}
const path = (name: string) => new PathSpec({ virtual: '/' + name, directory: '/', vfsPath: name })

export async function automationWorkspace(request: AutomationRequest): Promise<Workspace> {
  if (!Object.hasOwn(manifest.tasks, request.task)) throw new Error('Unregistered AutomationBench task')
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0)
    throw new Error('Invalid verifier timeout')
  if (Object.keys(request.files).sort().join() !== '/input/state.json,/input/task.json')
    throw new Error('Invalid frozen inputs')
  const task = Buffer.from(request.files['/input/task.json'], 'base64')
  if (sha256(task) !== manifest.tasks[request.task].files['task.json'])
    throw new Error('AutomationBench task changed; verify parity before updating its pin')
  const input = new RAMVFS(),
    output = new RAMVFS(),
    code = new RAMVFS()
  await input.write(path('task.json'), task)
  await input.write(path('models.json'), Buffer.from(models))
  await code.write(path('grader.py'), Buffer.from(program))
  // World doc strings stay byte-exact, including integers beyond JS's safe range.
  await input.write(path('state.json'), Buffer.from(request.files['/input/state.json'], 'base64'))
  const runtime = new MontyRuntime({ config: { maxMemory: 512 * 1024 * 1024 } })
  runtime.shared = false
  return new Workspace(
    {
      '/': [new RAMVFS(), MountMode.EXEC],
      '/input': [input, MountMode.READ],
      '/grader': [code, MountMode.EXEC],
      '/output': [output, MountMode.WRITE],
    },
    {
      maxMemory: 512 * 1024 * 1024,
      runtimes: [runtime, 'workspace'],
      commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) },
    }
  )
}

export async function verifyAutomation(request: AutomationRequest) {
  const started = performance.now(),
    workspace = await automationWorkspace(request)
  try {
    const result = await workspace.shell('python /grader/grader.py')
    if (result.exitCode !== 0)
      throw new Error(`Monty grader failed (${result.exitCode}): ${result.stderrText}`)
    const output = await workspace.shell('cat /output/reward_details.json')
    if (output.exitCode !== 0) throw new Error('AutomationBench did not write its reward')
    const details = JSON.parse(output.stdoutText),
      score = details.partial_credit
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1 ||
      details.task_completed_correctly !== Number(score === 1) ||
      !Array.isArray(details.assertions)
    )
      throw new Error('Invalid AutomationBench reward')
    return {
      score,
      rewards: { reward: score },
      checks: details,
      stdout: result.stdoutText,
      artifacts: { 'reward_details.json': details },
      timings: {
        run_s: (performance.now() - started) / 1000,
        peak_node_mib: process.resourceUsage().maxRSS / 1024,
      },
    }
  } finally {
    await workspace.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  console.log(JSON.stringify(await verifyAutomation(JSON.parse(input))))
}
