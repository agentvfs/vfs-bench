import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Monty } from '@pydantic/monty'
import { gaia2Workspace, judgeTransport, verifyGaia2 } from './verify-gaia2.ts'

const directory = new URL('./graders/gaia2/', import.meta.url)
const port = readFileSync(new URL('port.py', directory), 'utf8')
const python = fileURLToPath(new URL('../gaia2/.venv/bin/python', import.meta.url))
const scenario = new URL('../state/gaia2/harbor/search-0002/scenario.json', import.meta.url)

function request(answer?: string) {
  return {
    task: 'search-0002', timeoutSeconds: 20,
    env: { OPENAI_API_KEY: 'must-not-enter-the-workspace' }, judgeReplay: [],
    files: {
      '/input/scenario.json': readFileSync(scenario).toString('base64'),
      '/input/state.json': Buffer.from(JSON.stringify({ states: {}, trajectory: {
        steps: answer === undefined ? [] : [{ source: 'agent', message: answer }],
      } })).toString('base64'),
    },
  }
}

test('GAIA2 fresh VFS isolates inputs, outputs, host access and credentials', { skip: !existsSync(scenario) }, async () => {
  const first = await gaia2Workspace(request()), second = await gaia2Workspace(request())
  try {
    assert.notEqual((await first.workspace.shell('echo changed > /input/state.json')).exitCode, 0)
    assert.equal((await first.workspace.shell('echo private > /output/check')).exitCode, 0)
    assert.notEqual((await second.workspace.shell('cat /output/check')).exitCode, 0)
    assert.notEqual((await first.workspace.shell('cat /etc/passwd')).exitCode, 0)
    assert.notEqual((await first.workspace.shell("python -c 'import sqlite3'")).exitCode, 0)
    const credentials = await first.workspace.shell(`python -c 'import os; print(os.getenv("OPENAI_API_KEY", "absent"))'`)
    assert.equal(credentials.stdoutText.trim(), 'absent')
  } finally { await first.workspace.close(); await second.workspace.close() }
})

test('GAIA2 real search fixture passes its answer and fails a missing turn', { skip: !existsSync(scenario) }, async () => {
  const data = JSON.parse(readFileSync(scenario, 'utf8'))
  const event = data.events.find((e: any) => e.event_type === 'AGENT' && e.action.function === 'send_message_to_user')
  const answer = event.action.args.find((a: any) => a.name === 'content').value
  assert.equal((await verifyGaia2(request(answer))).score, 1)
  assert.equal((await verifyGaia2(request())).score, 0)
  const changed = request()
  changed.files['/input/scenario.json'] = Buffer.from('{}').toString('base64')
  await assert.rejects(verifyGaia2(changed), /scenario changed/)
})

test('GAIA2 checkers and prompt formatting match pinned CPython', { skip: !existsSync(python) }, async () => {
  const expressions = [
    `_normalize_str('Éléonore, Łódź! İ Ω ①')`,
    `_normalize_str('  a\\tb  c\\n')`,
    `normalize_arg({'value': [None, True, 1.5]})`,
    `list_attendees_checker(['Other'], [], [])`,
    `list_attendees_checker(['Éva'], ['eva', 'Me'], ['Me'])`,
    `unordered_list_checker(['a', 'a', 'b'], ['b', 'a'])`,
    `unordered_path_list_checker(['/a/../b'], ['b'])`,
    `phone_number_checker('+1 (234) ５６', '1234５６')`,
    `datetime_checker('2024-1-2 3:4:5', '2024-01-02 03:04:05')`,
    `_equality_checker({'content':'1.0'}, {'content':1.0})`,
    `placeholder_checker({'content': 'Best,\\nYour Name'})`,
    `jinja_format('a{{x}}b{{ y }}c', x='{{y}}', y='<&>')`,
    `LLMFunction(lambda messages: (messages, {}), EMAIL_CHECKER_PROMPT_TEMPLATES)({'agent_action_call':'a','oracle_action_call':'b','today_date':'2024-01-01 Monday'})`,
    `LLMChecker(lambda messages: ('[[Failure]] [[Success]]', {}), USER_MESSAGE_CHECKER_PROMPT_TEMPLATES)({})`,
    `LLMChecker(lambda messages: ('no verdict', {}), USER_MESSAGE_CHECKER_PROMPT_TEMPLATES)({})`,
  ]
  const expression = 'json.dumps([' + expressions.join(',\n') + '], ensure_ascii=False)'
  const reference = spawnSync(python, ['-c',
    'import json\nfrom gaia2_core.judge.checkers import *\nfrom gaia2_core.judge.checkers import _normalize_str, _equality_checker\nfrom gaia2_core.judge.prompts import *\nprint(' + expression + ')'], { encoding: 'utf8' })
  assert.equal(reference.status, 0, reference.stderr)
  const pool = await Monty.create({ maxProcesses: 1 })
  const session = await pool.checkout()
  try {
    const result = await session.feedRun(port + '\n' + expression)
    assert.deepEqual(JSON.parse(result as string), JSON.parse(reference.stdout))
  } finally { await session.close(); await pool.close() }
})

test('GAIA2 judge replay checks prompts, exhausted and unused responses', async () => {
  const messages = [{ role: 'user', content: 'check' }]
  const transport = judgeTransport({}, [{ messages, reply: '[[Success]]' }], 5)
  assert.equal(await transport.complete([new Map(Object.entries(messages[0]!))]), '[[Success]]')
  transport.finish()
  await assert.rejects(transport.complete(messages), /prompt mismatch/)
  assert.throws(() => judgeTransport({}, [{ messages, reply: null }], 5).finish(), /Unused/)
  await assert.rejects(judgeTransport({}, [{ messages, reply: null }], 5).complete([{ role: 'user', content: 'changed' }]), /prompt mismatch/)
  const missing = judgeTransport({}, undefined, 5)
  assert.equal(await missing.complete(messages), null)
  assert.match(missing.calls[0]!.error!, /unset/)
})

test('GAIA2 live transport preserves model, credentials, extra body and records responses', async () => {
  let received: any
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    received = { path: req.url, authorization: req.headers.authorization, ...JSON.parse(body) }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '[[True]]' } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const transport = judgeTransport({ OPENAI_API_KEY: 'test-only', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, JUDGE_MODEL: 'test-model', JUDGE_EXTRA_BODY: '{"reasoning_effort":"low"}' }, undefined, 5)
    const messages = [{ role: 'user', content: 'check' }]
    assert.equal(await transport.complete(messages), '[[True]]')
    assert.deepEqual(received, { path: '/v1/chat/completions', authorization: 'Bearer test-only', model: 'test-model', messages, temperature: 0, reasoning_effort: 'low' })
    assert.deepEqual(transport.calls, [{ messages, reply: '[[True]]' }])
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) }
})
