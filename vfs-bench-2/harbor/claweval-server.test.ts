/** Shared HTTP-process grading: access control, parallelism and cancellation. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import Fastify from '../submodule/mirage/typescript/packages/server/node_modules/fastify/fastify.js'
import { registerClawVerifier } from './claweval-server.ts'
import type { ClawRequest } from './verify-claweval.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const python = process.env.VFSBENCH_TEST_PYTHON || root + 'harbor/.venv/bin/python'
const ready = existsSync(python) && existsSync(root + 'state/claweval/src/src/claw_eval') &&
  existsSync(root + 'state/harbor/claweval-pyodide')
const task = 'T085_officeqa_army_expenditures'
const headers = { authorization: 'Bearer private-test-capability' }
function fixture(scenario = 'complete'): { request: ClawRequest; rewards: unknown } {
  return JSON.parse(execFileSync(python, ['-c', `
import importlib.util, json
s = importlib.util.spec_from_file_location('audit', 'harbor/audit_claweval.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
r, rewards, details = m.reference_case('${task}', '${scenario}')
print(json.dumps({'request': r, 'rewards': rewards}))
`], { cwd: root, encoding: 'utf8', maxBuffer: 4 << 20 }))
}
function server(send: typeof fetch = fetch) {
  const app = Fastify()
  registerClawVerifier(app, { token: 'private-test-capability', task, fetch: send })
  app.get('/health', () => ({ pid: process.pid }))
  return app
}
const payload = (request: ClawRequest) => ({ ...request, runtime: 'claweval-pyodide' })

test('Server verifier requires a private capability and the configured trial task', async () => {
  const app = server()
  try {
    const body = { task: 'wrong-task', runtime: 'claweval-pyodide', files: {}, timeoutSeconds: 5 }
    const denied = await app.inject({ method: 'POST', url: '/v1/harbor/claweval/verify', payload: body })
    assert.equal(denied.statusCode, 403)
    const wrong = await app.inject({ method: 'POST', url: '/v1/harbor/claweval/verify', headers, payload: body })
    assert.equal(wrong.statusCode, 400)
    assert.equal((await app.inject('/health')).statusCode, 200)
  } finally { await app.close() }
})

test('Parallel server requests have separate verifier workspaces in the server process', { skip: !ready }, async () => {
  const app = server(async () => { throw new Error('replay must not contact judge') })
  try {
    const cases = ['complete', 'partial'].map(fixture)
    const replies = await Promise.all(cases.map(({ request }) => app.inject({
      method: 'POST', url: '/v1/harbor/claweval/verify', headers, payload: payload(request),
    })))
    for (const [index, reply] of replies.entries()) {
      assert.equal(reply.statusCode, 200, reply.body)
      assert.deepEqual(reply.json().rewards, cases[index].rewards)
      assert.equal(reply.json().timings.server_pid, process.pid)
      assert.equal(reply.json().timings.execution, 'trial-daemon')
    }
    assert.notDeepEqual(replies[0].json().rewards, replies[1].json().rewards)
    assert.equal((await app.inject('/health')).statusCode, 200)
  } finally { await app.close() }
})

test('A verifier deadline leaves the HTTP server available for later requests', { skip: !ready }, async () => {
  const app = server()
  try {
    const { request } = fixture()
    request.timeoutSeconds = 0.001
    const reply = await app.inject({ method: 'POST', url: '/v1/harbor/claweval/verify', headers, payload: payload(request) })
    assert.equal(reply.statusCode, 500)
    assert.equal(reply.json().rewards, undefined)
    assert.equal((await app.inject('/health')).statusCode, 200)
  } finally { await app.close() }
})

test('Disconnect cancels grading and its judge transport without stopping the server', { skip: !ready }, async () => {
  let started!: () => void, aborted!: () => void
  const waiting = new Promise<void>((resolve) => { started = resolve })
  const stopped = new Promise<void>((resolve) => { aborted = resolve })
  const app = server(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    started()
    const stop = () => { aborted(); reject(new Error('canceled')) }
    if (init?.signal?.aborted) stop()
    else init?.signal?.addEventListener('abort', stop, { once: true })
  }))
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const { request } = fixture()
    delete request.files['/input/recording.json']
    request.env = { OPENAI_API_KEY: 'test', JUDGE_MODEL: 'fixture' }
    const controller = new AbortController()
    const response = fetch(address + '/v1/harbor/claweval/verify', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload(request)), signal: controller.signal,
    }).then(() => assert.fail('canceled request succeeded'), () => {})
    await Promise.race([waiting, delay(15000, undefined, { ref: false }).then(() => { throw new Error('judge never called') })])
    assert.equal((await fetch(address + '/health')).status, 200)
    controller.abort()
    await response
    await Promise.race([stopped, delay(5000, undefined, { ref: false }).then(() => { throw new Error('judge not canceled') })])
    assert.equal((await fetch(address + '/health')).status, 200)
  } finally { await app.close() }
})

test('Failed parsing streams frozen inputs and recordings before the error', { skip: !ready }, async () => {
  const app = server(async () => { throw new Error('replay must not contact judge') })
  try {
    const { request } = fixture()
    const tape = JSON.parse(Buffer.from(request.files['/input/recording.json'], 'base64').toString())
    const invalid = { request: tape[0].request, response: { choices: [{ message: { content: 'not JSON' } }] } }
    const recording = Array(31).fill(invalid)
    request.files['/input/recording.json'] = Buffer.from(JSON.stringify(recording)).toString('base64')
    const reply = await app.inject({ method: 'POST', url: '/v1/harbor/claweval/verify',
      headers: { ...headers, accept: 'application/x-ndjson' }, payload: payload(request) })
    const events = reply.body.trim().split('\n').map((line: string) => JSON.parse(line))
    assert.equal(events[0].name, 'claweval-inputs.json')
    assert.equal(events[1].name, 'judge-recording.json')
    assert.deepEqual(events[1].value, recording)
    assert.equal(events.at(-1).type, 'error')
    assert.match(events.at(-1).detail, /the judge did not answer/)
    assert.equal(events.some((event: { type: string }) => event.type === 'result'), false)
  } finally { await app.close() }
})

test('Live judge requests and replies arrive before the stream is canceled', { skip: !ready }, async () => {
  const raw = { choices: [{ message: { content: 'invalid reply' } }] }
  const app = server(async () => Response.json(raw))
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const { request } = fixture()
    delete request.files['/input/recording.json']
    request.env = { OPENAI_API_KEY: 'private-test-key', JUDGE_MODEL: 'fixture' }
    const controller = new AbortController()
    const response = await fetch(address + '/v1/harbor/claweval/verify', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(payload(request)), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = '', pending = false, recorded = false
    while (!recorded) {
      const chunk = await reader.read()
      assert.equal(chunk.done, false)
      buffer += chunk.value
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n')
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        assert.equal(line.includes('private-test-key'), false)
        const event = JSON.parse(line)
        if (event.name !== 'judge-recording.json' || !event.value.length) continue
        pending ||= event.value[0].error?.message === 'Judge response not received'
        if (event.value[0].response) {
          assert.deepEqual(event.value[0].response, raw)
          recorded = true
        }
      }
    }
    assert.equal(pending, true)
    controller.abort()
    await reader.cancel().catch(() => {})
    assert.equal((await fetch(address + '/health')).status, 200)
  } finally { await app.close() }
})
