/** GAIA2's pinned judge, inside a fresh Mirage/Monty workspace. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MontyRuntime } from '@struktoai/mirage-core/runtime/python/monty/runtime'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'
import { quote } from '../../../workspace/grader.ts'

const directory = new URL('./', import.meta.url)
const sources = JSON.parse(readFileSync(new URL('sources.json', directory), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const port = readFileSync(new URL('port.py', directory), 'utf8')
if (createHash('sha256').update(port).digest('hex') !== sources.port_sha256)
  throw new Error('GAIA2 port changed; regenerate and verify parity')
const program = port + '\n' + readFileSync(new URL('main.py', directory), 'utf8')
const path = (name: string) => new PathSpec({ virtual: name, directory: '/', vfsPath: name.slice(1) })
type Message = { role: string; content: string }
function messagesFromMonty(value: unknown): Message[] {
  if (!Array.isArray(value)) throw new Error('Invalid judge messages')
  return value.map(item => {
    const message = item instanceof Map ? Object.fromEntries(item) : item
    if (!message || typeof message.role !== 'string' || typeof message.content !== 'string')
      throw new Error('Invalid judge message')
    return { role: message.role, content: message.content }
  })
}
export type JudgeCall = { messages: Message[]; reply?: string | null; error?: string }
export interface Gaia2Request {
  task: string
  files: Record<string, string>
  env?: Record<string, string>
  judgeReplay?: JudgeCall[]
  timeoutSeconds: number
}

/** The host only transports messages. All checker decisions stay in Monty. */
export function judgeTransport(env: Record<string, string>, replay: JudgeCall[] | undefined, timeout: number) {
  const calls: JudgeCall[] = []
  const deadline = Date.now() + timeout * 1000
  const extra = JSON.parse(env.JUDGE_EXTRA_BODY || '{}')
  if (!extra || Array.isArray(extra) || typeof extra !== 'object')
    throw new Error('JUDGE_EXTRA_BODY must be a JSON object')
  return {
    calls,
    finish() {
      if (replay && calls.length !== replay.length) throw new Error('Unused GAIA2 judge replay responses')
    },
    async complete(value: unknown): Promise<string | null> {
      const messages = messagesFromMonty(value)
      if (replay) {
        const call = replay[calls.length]
        if (!call || JSON.stringify(call.messages) !== JSON.stringify(messages))
          throw new Error(`GAIA2 judge replay prompt mismatch at call ${calls.length}`)
        calls.push(call)
        return call.reply ?? null
      }
      if (!env.OPENAI_API_KEY) {
        calls.push({ messages, error: 'no judge: OPENAI_API_KEY is unset' })
        return null
      }
      const url = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions'
      const body = JSON.stringify({ model: env.JUDGE_MODEL || 'gpt-oss-120b', messages, temperature: 0, ...extra })
      let error = ''
      for (let attempt = 0; attempt < 6; attempt++) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error('GAIA2 judge deadline exceeded')
        try {
          const response = await fetch(url, {
            method: 'POST', redirect: 'error',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
            body, signal: AbortSignal.timeout(Math.max(1, Math.min(300_000, remaining))),
          })
          if (!response.ok) throw new Error(`Judge HTTP ${response.status}`)
          const data = await response.json() as { choices: { message: { content?: string | null } }[] }
          const reply = data.choices[0]!.message.content ?? null
          if (reply !== null && typeof reply !== 'string') throw new Error('Invalid judge content')
          calls.push({ messages, reply })
          return reply
        } catch (exc) {
          error = String(exc)
          if (attempt < 5) await new Promise(resolve => setTimeout(resolve, Math.min(2 ** attempt * 1000, 30_000, Math.max(0, deadline - Date.now()))))
        }
      }
      calls.push({ messages, error })
      return null
    },
  }
}

export async function gaia2Workspace(request: Gaia2Request) {
  if (!Object.hasOwn(manifest.tasks, request.task)) throw new Error('Unregistered GAIA2 task')
  if (!Number.isFinite(request.timeoutSeconds) || request.timeoutSeconds <= 0) throw new Error('Invalid verifier timeout')
  const allowed = ['/input/state.json', '/input/scenario.json']
  if (Object.keys(request.files).length !== allowed.length || allowed.some(p => !Object.hasOwn(request.files, p)))
    throw new Error('Invalid GAIA2 frozen inputs')
  const scenario = Buffer.from(request.files['/input/scenario.json']!, 'base64')
  if (createHash('sha256').update(scenario).digest('hex') !== manifest.tasks[request.task].scenario_sha256)
    throw new Error('GAIA2 scenario changed; verify parity first')
  const input = new RAMVFS(), output = new RAMVFS()
  for (const [name, data] of Object.entries(request.files))
    await input.write(path(name.slice('/input'.length)), Buffer.from(data, 'base64'))
  const transport = judgeTransport(request.env ?? {}, request.judgeReplay, request.timeoutSeconds)
  const runtime = new MontyRuntime({ config: { maxMemory: 512 * 1024 * 1024 } })
  runtime.shared = false
  runtime.externalLookup = { judge_completion: (messages: Message[]) => transport.complete(messages) }
  const workspace = new Workspace({
    '/': [new RAMVFS(), MountMode.EXEC],
    '/input': [input, MountMode.READ], '/output': [output, MountMode.WRITE],
  }, {
    runtimes: [runtime, 'workspace'], maxMemory: 512 * 1024 * 1024,
    commandLimits: { '@line': new Limit({ timeoutSeconds: request.timeoutSeconds }) },
  })
  return { workspace, transport }
}

export async function verifyGaia2(request: Gaia2Request) {
  const started = performance.now()
  const { workspace, transport } = await gaia2Workspace(request)
  try {
    const run = await workspace.shell('python -c ' + quote(program))
    if (run.exitCode !== 0) throw new Error(`GAIA2 Monty grader failed: ${run.stderrText}`)
    transport.finish()
    const result = await workspace.shell('cat /output/reward_details.json')
    if (result.exitCode !== 0) throw new Error('GAIA2 did not write a reward')
    const details = JSON.parse(result.stdoutText)
    if (![0, 1].includes(details.reward)) throw new Error('Invalid GAIA2 reward')
    const judgments = await workspace.shell('cat /output/judgments.jsonl')
    details.judgments = judgments.exitCode === 0
      ? judgments.stdoutText.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
    details.judge_calls = transport.calls
    return {
      score: details.reward, rewards: { reward: details.reward },
      checks: { success: details.success, failure_reason: details.failure_reason },
      artifacts: { 'reward_details.json': details },
      stdout: `${details.success ? 'PASS' : 'FAIL'}${details.failure_reason ? ': ' + details.failure_reason : ''}\n`,
      timings: { run_s: (performance.now() - started) / 1000, peak_node_mib: process.resourceUsage().maxRSS / 1024 },
    }
  } finally { await workspace.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  console.log(JSON.stringify(await verifyGaia2(JSON.parse(input))))
}
