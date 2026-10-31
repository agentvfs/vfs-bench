/** DataSpace's pinned evaluator runs on frozen files inside Mirage + Monty. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MontyRuntime } from '@struktoai/mirage-core/runtime/python/monty/runtime'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'
import { quote } from '../../../workspace/grader.ts'

const directory = new URL('./', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const port = readFileSync(new URL('port.py', directory), 'utf8')
if (createHash('sha256').update(port).digest('hex') !== manifest.port_sha256)
  throw new Error('DataSpace port changed; regenerate and verify parity')
const program = [
  port,
  readFileSync(new URL('csv_compat.py', directory), 'utf8'),
  readFileSync(new URL('datetime_compat.py', directory), 'utf8'),
  readFileSync(new URL('main.py', directory), 'utf8'),
].join('\n')
export interface DataSpaceRequest {
  task: string
  files: Record<string, string>
  timeoutSeconds: number
}
const path = (name: string) => new PathSpec({ virtual: name, directory: '/', vfsPath: name.slice(1) })

export async function dataSpaceWorkspace(request: DataSpaceRequest): Promise<Workspace> {
  const definition = manifest.tasks[request.task]
  if (!Object.hasOwn(manifest.tasks, request.task)) throw new Error('Unregistered DataSpace task')
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0)
    throw new Error('Invalid verifier timeout')
  const allowed = [
    '/output/prediction.csv',
    '/.verifier-input/status.json',
    `/opt/dataspace-evaluation/configs/${definition.task_id}.json`,
    '/opt/dataspace-evaluation/gold/gold.csv',
  ]
  if (Object.keys(request.files).some((p) => !allowed.includes(p)))
    throw new Error('Invalid frozen input path')
  for (const required of allowed.slice(1))
    if (!Object.hasOwn(request.files, required)) throw new Error(`Missing frozen input: ${required}`)
  const output = new RAMVFS()
  const inputs = { '/output': new RAMVFS(), '/opt': new RAMVFS(), '/.verifier-input': new RAMVFS() }
  for (const [name, base64] of Object.entries(request.files)) {
    const prefix = Object.keys(inputs).find((p) => name.startsWith(p + '/'))! as keyof typeof inputs
    const input = inputs[prefix],
      relative = name.slice(prefix.length)
    await input.mkdir(path(relative.slice(0, relative.lastIndexOf('/')) || '/'), true)
    await input.write(path(relative), Buffer.from(base64, 'base64'))
  }
  const runtime = new MontyRuntime({ config: { maxMemory: 512 * 1024 * 1024 } })
  runtime.shared = false
  const workspace = new Workspace(
    {
      '/': [new RAMVFS(), MountMode.EXEC],
      '/output': [inputs['/output'], MountMode.READ],
      '/opt': [inputs['/opt'], MountMode.READ],
      '/.verifier-input': [inputs['/.verifier-input'], MountMode.READ],
      '/.verifier-output': [output, MountMode.WRITE],
    },
    {
      maxMemory: 512 * 1024 * 1024,
      runtimes: [runtime, 'workspace'],
      commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) },
    }
  )
  return workspace
}
export async function verifyDataSpace(request: DataSpaceRequest) {
  const started = performance.now(),
    definition = manifest.tasks[request.task]
  const workspace = await dataSpaceWorkspace(request)
  try {
    const result = await workspace.shell('python -c ' + quote(program))
    if (result.exitCode !== 0)
      throw new Error(`Monty grader failed (${result.exitCode}): ${result.stderrText}`)
    const reward = await workspace.shell('cat /.verifier-output/evaluation.json')
    if (reward.exitCode !== 0) throw new Error('DataSpace did not write its evaluation')
    const evaluation = JSON.parse(reward.stdoutText)
    if (![0, 1].includes(evaluation.score) || evaluation.task_id !== definition.task_id)
      throw new Error('Invalid DataSpace evaluation')
    return {
      score: evaluation.score,
      checks: { passed: evaluation.passed, error_code: evaluation.error_code ?? '' },
      stdout: JSON.stringify(evaluation, null, 1) + '\n',
      artifacts: { 'evaluation.json': evaluation },
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
  console.log(JSON.stringify(await verifyDataSpace(JSON.parse(input))))
}
