/** Claw-Eval compatibility grading in a fresh Mirage/Pyodide RAM workspace. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { PyodideRuntime } from '@struktoai/mirage-core/runtime/python/pyodide/runtime'
import { materialize } from '@struktoai/mirage-core/io/types'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'
import { quote } from './graders/context.ts'

const directory = new URL('./graders/claweval/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const packages = fileURLToPath(new URL('../state/harbor/claweval-pyodide/', import.meta.url))
const runtimeRequire = createRequire(import.meta.resolve('@struktoai/mirage-core/runtime/python/pyodide/runtime'))
if (runtimeRequire('pyodide/package.json').version !== '314.0.5')
  throw new Error('Review Claw-Eval parity before changing Pyodide 314.0.5')
const path = (name: string) => new PathSpec({ virtual: '/' + name, directory: '/', vfsPath: name })
type Recording = { request: Record<string, unknown>; response?: unknown; error?: { message: string; status?: number } }
export interface ClawRequest {
  task: string
  files: Record<string, string>
  env?: Record<string, string>
  timeoutSeconds: number
}
export type JudgeTransport = (request: Record<string, unknown>, signal: AbortSignal) => Promise<Omit<Recording, 'request'>>

/** Credentials remain in the trusted transport, never in Python or the tape. */
export function judgeTransport(env: Record<string, string>, send: typeof fetch = fetch): JudgeTransport {
  return async (request, signal) => {
    if (!env.OPENAI_API_KEY) throw new Error('Claw-Eval judge requires OPENAI_API_KEY')
    const url = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions'
    const target = new URL(url)
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
      throw new Error('Invalid Claw-Eval judge URL')
    try {
      const response = await send(target, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify(request),
      })
      if (!response.ok) return { error: { message: `Judge HTTP ${response.status}`, status: response.status } }
      // Bound untrusted remote replies before storing or passing them to WASM.
      const reader = response.body?.getReader()
      if (!reader) return { error: { message: 'Empty judge response' } }
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.length
          if (size > 4 * 1024 * 1024) throw new Error('Judge response exceeds 4 MiB')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel() }
      return { response: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    } catch (error) {
      if (signal.aborted) throw error
      // Never echo credentials, endpoint query strings, or arbitrary error bodies.
      return { error: { message: 'Judge transport failed' } }
    }
  }
}

export async function verifyClaw(request: ClawRequest, transport?: JudgeTransport, externalSignal?: AbortSignal) {
  externalSignal?.throwIfAborted()
  const definition = manifest.tasks[request.task]
  if (!definition) throw new Error('Unregistered Claw-Eval task')
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0)
    throw new Error('Invalid verifier timeout')
  const started = performance.now()
  const controller = new AbortController()
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal
  const input = new RAMVFS(), reference = new RAMVFS(), grader = new RAMVFS(), output = new RAMVFS()
  const allowed = new Set(['state.json', 'trajectory.json', 'dispatches.jsonl', 'gws_seed.json', 'recording.json'])
  const required = new Set(Object.keys(definition.sources).map((name) => '/reference/' + name))
  required.add('/reference/assembly.py')
  let recording: Recording[] | undefined
  for (const [virtual, encoded] of Object.entries(request.files)) {
    const bytes = Buffer.from(encoded, 'base64')
    if (virtual.startsWith('/reference/')) {
      const name = virtual.slice('/reference/'.length)
      if (!required.delete(virtual)) throw new Error('Unexpected Claw-Eval reference source')
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== (name === 'assembly.py' ? manifest.assembly_sha256 : definition.sources[name]))
        throw new Error('Claw-Eval reference source drift: ' + name)
      if (name.includes('/')) await reference.mkdir(path(name.slice(0, name.lastIndexOf('/'))), true)
      await reference.write(path(name), bytes)
    } else if (virtual.startsWith('/input/') && allowed.has(virtual.slice(7))) {
      const name = virtual.slice(7)
      if (name === 'recording.json') recording = JSON.parse(bytes.toString('utf8'))
      else await input.write(path(name), bytes)
    } else throw new Error('Unexpected Claw-Eval input: ' + virtual)
  }
  if (required.size) throw new Error('Missing Claw-Eval reference sources')
  if (!Object.hasOwn(request.files, '/input/state.json')) throw new Error('Missing Claw-Eval frozen state')
  const state = JSON.parse(Buffer.from(request.files['/input/state.json'], 'base64').toString('utf8'))
  if (state.task !== request.task) throw new Error('Claw-Eval task/input identity mismatch')
  if (recording !== undefined && !Array.isArray(recording)) throw new Error('Invalid judge recording')
  const env = request.env ?? {}
  const model = env.JUDGE_MODEL || 'google/gemini-3-flash-preview'
  await input.write(path('settings.json'), Buffer.from(JSON.stringify({ model })))
  for (const name of ['main.py', 'gws.py'])
    await grader.write(path(name), readFileSync(new URL(name, directory)))
  const runtime = new PyodideRuntime({ config: {
    packages: ['pydantic', 'pyyaml'], packageBaseUrl: packages,
    autoLoadFromImports: false, maxMemory: '512M',
  } })
  const workspace = new Workspace({
    // EXEC authorizes the interpreter. Pyodide retains its own stdlib at
    // '/', and serves the explicit /input, /reference and /output mounts.
    '/': [new RAMVFS(), MountMode.EXEC], '/input': [input, MountMode.READ],
    '/reference': [reference, MountMode.READ], '/grader': [grader, MountMode.READ],
    '/output': [output, MountMode.WRITE],
  }, { runtimes: [runtime, 'workspace'],
    commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) } })
  const tape = recording ?? []
  const call = transport ?? judgeTransport(env)
  const timer = setTimeout(() => controller.abort(), request.timeoutSeconds * 1000)
  try {
    for (let attempt = 0; attempt <= 128; attempt++) {
      if (signal.aborted) throw new Error('Claw-Eval verifier deadline exceeded or canceled')
      await input.write(path('tape.json'), Buffer.from(JSON.stringify(tape)))
      const result = await workspace.shell('python -c ' + quote(
        'import runpy; runpy.run_path("/grader/main.py", run_name="__main__")'), { signal })
      if (result.exitCode !== 0)
        throw new Error(`Claw-Eval Pyodide grader failed (${result.exitCode}): ${result.stderrText}`)
      signal.throwIfAborted()
      const value = JSON.parse(new TextDecoder().decode(await materialize(await output.read(path('result.json')))))
      if (value.judge_request) {
        if (recording !== undefined) throw new Error('Judge recording exhausted')
        if (attempt === 128) throw new Error('Claw-Eval judge call limit exceeded')
        if (!Number.isFinite(value.judge_delay) || value.judge_delay < 0 || value.judge_delay > 60)
          throw new Error('Invalid Claw-Eval judge backoff')
        if (value.judge_delay)
          await delay(value.judge_delay * 1000, undefined, { signal })
        const response = await call(value.judge_request, signal)
        tape.push({ request: value.judge_request, ...response })
        continue
      }
      if (Object.keys(value.rewards ?? {}).sort().join() !== 'completion,passed,reward,robustness,safety' ||
          !Object.values(value.rewards).every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) ||
          ![0, 1].includes(value.rewards.passed) || value.score !== value.rewards.reward)
        throw new Error('Invalid Claw-Eval rewards')
      return { ...value, artifacts: { ...value.artifacts, 'judge-recording.json': tape,
          'claweval-inputs.json': { task: request.task, model,
            files: Object.fromEntries(Object.entries(request.files).filter(([name]) =>
              name.startsWith('/input/') && name !== '/input/recording.json')) } },
        timings: { run_s: (performance.now() - started) / 1000, runtime: 'pyodide',
          judge_calls: tape.length, peak_node_mib: process.resourceUsage().maxRSS / 1024 } }
    }
    throw new Error('Claw-Eval judge loop exhausted')
  } finally {
    clearTimeout(timer)
    controller.abort()
    await workspace.close()
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  console.log(JSON.stringify(await verifyClaw(JSON.parse(input))))
}
