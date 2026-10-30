/** Runtime replay, source integrity and judge transport regression checks. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { judgeTransport, verifyClaw, type ClawRequest } from './verify-claweval.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const python = process.env.VFSBENCH_TEST_PYTHON || root + 'harbor/.venv/bin/python'
const ready = existsSync(python) && existsSync(root + 'state/claweval/src/src/claw_eval') &&
  existsSync(root + 'state/harbor/claweval-pyodide')
function fixture(): ClawRequest {
  return JSON.parse(execFileSync(python, ['-c', `
import importlib.util, json
s = importlib.util.spec_from_file_location('audit', 'harbor/audit_claweval.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(json.dumps(m.reference_case('T085_officeqa_army_expenditures', 'complete')[0]))
`], { cwd: root, encoding: 'utf8', maxBuffer: 4 << 20 }))
}

test('Claw-Eval replay matches raw requests and never calls a live judge', { skip: !ready }, async () => {
  const request = fixture()
  const result = await verifyClaw(request, async () => { throw new Error('unexpected live judge') })
  assert.equal(result.rewards.safety, 1)
  assert.equal(result.artifacts['judge-recording.json'].length > 0, true)
  const tape = JSON.parse(Buffer.from(request.files['/input/recording.json'], 'base64').toString())
  tape[0].request.messages[0].content = 'different rubric'
  request.files['/input/recording.json'] = Buffer.from(JSON.stringify(tape)).toString('base64')
  await assert.rejects(verifyClaw(request), /differs from recording/)
  request.files['/input/recording.json'] = Buffer.from('[]').toString('base64')
  await assert.rejects(verifyClaw(request), /recording exhausted/)
})

test('Claw-Eval retains upstream judge parsing retries and fails on exhaustion', { skip: !ready }, async () => {
  const request = fixture()
  const tape = JSON.parse(Buffer.from(request.files['/input/recording.json'], 'base64').toString())
  const invalid = { request: tape[0].request, response: { choices: [{ message: { content: 'not JSON' } }] } }
  request.files['/input/recording.json'] = Buffer.from(JSON.stringify([invalid, ...tape])).toString('base64')
  const result = await verifyClaw(request)
  assert.equal(result.rewards.reward, 1)
  request.files['/input/recording.json'] = Buffer.from(JSON.stringify(Array(31).fill(invalid))).toString('base64')
  await assert.rejects(verifyClaw(request), /the judge did not answer/)
})

test('Claw-Eval pauses and resumes through an explicit judge transport', { skip: !ready }, async () => {
  const request = fixture()
  const tape = JSON.parse(Buffer.from(request.files['/input/recording.json'], 'base64').toString())
  delete request.files['/input/recording.json']
  let calls = 0
  const result = await verifyClaw(request, async (value) => {
    assert.deepEqual(value, tape[calls].request)
    return { response: tape[calls++].response }
  })
  assert.equal(calls, tape.length)
  assert.deepEqual(result.artifacts['judge-recording.json'], tape)
})

test('Claw-Eval refuses altered reference code and undeclared inputs', { skip: !ready }, async () => {
  const request = fixture()
  const key = Object.keys(request.files).find((p) => p.endsWith('/grader.py'))!
  request.files[key] = Buffer.from('raise Exception("injected")').toString('base64')
  await assert.rejects(verifyClaw(request), /source drift/)
  const forged = fixture()
  forged.files['/output/reward.json'] = Buffer.from('{"reward": 1}').toString('base64')
  await assert.rejects(verifyClaw(forged), /Unexpected Claw-Eval input/)
})

test('Judge transport sends the configured model and keeps credentials out of recordings', async () => {
  let auth = '', body: unknown
  const response = { choices: [{ message: { content: '{"score":0.5,"reasoning":"fixture"}' } }] }
  const server = createServer(async (req, res) => {
    auth = req.headers.authorization ?? ''
    let text = ''
    for await (const chunk of req) text += chunk
    body = JSON.parse(text)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(response))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const request = { model: 'test-model', messages: [{ role: 'user', content: 'rubric' }] }
    const call = judgeTransport({ OPENAI_API_KEY: 'private-test-key', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` })
    const result = await call(request, AbortSignal.timeout(5000))
    assert.deepEqual(result, { response })
    assert.deepEqual(body, request)
    assert.equal(auth, 'Bearer private-test-key')
    assert.equal(JSON.stringify(result).includes('private-test-key'), false)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('Judge transport cancels unsuccessful response bodies before recording HTTP errors', async () => {
  let canceled = 0
  const call = judgeTransport({ OPENAI_API_KEY: 'test' }, async () => new Response(
    new ReadableStream({ cancel() { canceled++ } }), { status: 429 }))
  for (let retry = 0; retry < 3; retry++) {
    assert.deepEqual(await call({ model: 'fixture' }, AbortSignal.timeout(1000)),
      { error: { message: 'Judge HTTP 429', status: 429 } })
    assert.equal(canceled, retry + 1)
  }
})

test('Completed judge replies are emitted before a later cancellation fails the grade', { skip: !ready }, async () => {
  const request = fixture()
  const tape = JSON.parse(Buffer.from(request.files['/input/recording.json'], 'base64').toString())
  delete request.files['/input/recording.json']
  const controller = new AbortController()
  const artifacts: Record<string, any> = {}
  let sawPending = false
  await assert.rejects(verifyClaw(request, async (value) => {
    assert.equal(sawPending, true)
    assert.deepEqual(value, tape[0].request)
    return { response: tape[0].response }
  }, controller.signal, (name, value) => {
    artifacts[name] = structuredClone(value)
    if (name === 'judge-recording.json') {
      sawPending ||= artifacts[name][0]?.error?.message === 'Judge response not received'
      if (artifacts[name][0]?.response) controller.abort()
    }
  }))
  assert.deepEqual(artifacts['judge-recording.json'], [tape[0]])
  assert.equal(artifacts['claweval-inputs.json'].task, request.task)
})
