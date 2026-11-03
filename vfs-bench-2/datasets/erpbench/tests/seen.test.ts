/**
 * graders/seen.ts: a mount read stays in the trace only if the trajectory
 * step that issued it shows its witness (ClawEval's rule, in order). The
 * trace has a CLI read, two mount reads of one file before a CLI write, the
 * write, and a mount read after it; each case is a trajectory and the trace
 * indices it keeps. The last two tests need datasets/erpbench/download.py.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { flat, seenTrace, type Seen } from '../graders/seen.ts'
import { verify } from '../../../workspace/verify.ts'
import MANIFEST from '../graders/manifest.json' with { type: 'json' }
import { dumps } from '../mocks/erpbench/py.ts'

const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'
const TESTS = 'state/erpbench/src/benchmark/erpbench100/release/harbor/tasks/erpbench-001/tests'
const DOWNLOADED = existsSync(TESTS)

const entry = (index: number, tool: string, args: object) => ({ index, server: tool.split('.')[0], tool, arguments: args, success: true, result: {} })
const TRACE = [
  entry(1, 'erpbench.get_task', { task_id: 'erpbench-001' }),
  entry(2, 'google_drive.files.download', { fileId: 'FILE-A' }),
  entry(3, 'google_drive.files.download', { fileId: 'FILE-A' }),
  entry(4, 'oracle_fusion.sales_orders.create', {}),
  entry(5, 'google_drive.files.download', { fileId: 'FILE-A' }),
]
const WITNESS = 'Line 7,CA-PO-77310,BRK-3 bracket,400'
// Host times: steps at 1000, 2000, 3000 ms; the mount reads at 1100, 2100, 3100.
const seenRows = (witness: Seen['witness'] = { all: [WITNESS] }): Seen[] => [
  { idx: 2, at_ms: 1100, witness },
  { idx: 3, at_ms: 2100, witness },
  { idx: 5, at_ms: 3100, witness },
]
const step = (ms: number, content: unknown, extra: object = {}) => ({
  source: 'agent',
  timestamp: new Date(ms).toISOString(),
  message: '',
  tool_calls: [{ tool_call_id: `c${ms}`, function_name: 'exec', arguments: { cmd: 'x' } }],
  observation: { results: [{ source_call_id: `c${ms}`, content }] },
  ...extra,
})
const kept = (steps: unknown, seen: Seen[] = seenRows(), shift = 0, name = 'codex') =>
  seenTrace(TRACE, seen, { agent: { name }, steps }, shift).map((e) => e.index)

test('a mount read counts only where its own step shows its witness', () => {
  const rows: [string, unknown, number[]][] = [
    ['shown by every issuing step', [step(1000, WITNESS), step(2000, WITNESS), step(3000, WITNESS)], [1, 2, 3, 4, 5]],
    ['shown only by the step after (order kept)', [step(1000, 'nothing'), step(2000, WITNESS), step(3000, 'nothing')], [1, 3, 4]],
    ['only in the agent message', [step(1000, 'nothing', { message: WITNESS }), step(2000, 'x'), step(3000, 'x')], [1, 4]],
    [
      'only in the user prompt',
      [{ source: 'user', timestamp: new Date(900).toISOString(), message: WITNESS }, step(1000, 'x'), step(2000, 'x'), step(3000, 'x')],
      [1, 4],
    ],
    ['content as text parts', [step(1000, [{ type: 'text', text: `before ${WITNESS} after` }]), step(2000, 'x'), step(3000, 'x')], [1, 2, 4]],
    ['split across lines and spaces', [step(1000, 'Line 7,\n  CA-PO-77310,BRK-3   bracket,400'), step(2000, 'x'), step(3000, 'x')], [1, 2, 4]],
    ['a step without a timestamp', [{ ...step(1000, WITNESS), timestamp: undefined }, step(2000, 'x'), step(3000, 'x')], [1, 4]],
    [
      'the witness in a step\'s second result',
      [{ ...step(1000, 'x'), observation: { results: [{ content: 'x' }, { content: WITNESS }] } }, step(2000, 'x'), step(3000, 'x')],
      [1, 2, 4],
    ],
    ['a step with no output between', [step(1000, WITNESS), { source: 'agent', timestamp: new Date(1500).toISOString(), message: 'thinking' }, step(3000, 'x')], [1, 2, 4]],
    ['content that is no text', [step(1000, null), step(2000, [{ type: 'image' }, null]), step(3000, 'x')], [1, 4]],
    [
      'the witness in an untimestamped step after the read\'s',
      [step(1000, 'x'), { source: 'agent', message: '', observation: { results: [{ content: WITNESS }] } }, step(3000, 'x')],
      // Both reads before 3000 belong to the step at 1000, which the untimestamped step's output joins.
      [1, 2, 3, 4],
    ],
    // On a host not on UTC, reading a zone-less time as local would move every step by hours.
    ['timestamps without a zone', [step(1000, WITNESS), step(2000, 'x'), step(3000, 'x')].map((s) => ({ ...s, timestamp: s.timestamp.slice(0, -1) })), [1, 2, 4]],
    ['no agent step before the read', [step(5000, WITNESS)], [1, 4]],
  ]
  for (const [name, steps, want] of rows) assert.deepEqual(kept(steps), want, name)
})

test('a witness survives the escaping an agent prints it through', () => {
  const witness = '"body_text":"**Northbridge Fastener Works · Toledo'
  const twice = JSON.stringify(JSON.stringify({ shown: `{${witness}}` })).replace('·', '\\\\u00b7')
  const once = JSON.stringify({ shown: witness }).replace('·', '\\u00b7')
  for (const content of [twice, once])
    assert.deepEqual(kept([step(1000, content), step(2000, 'x'), step(3000, 'x')], seenRows({ all: [witness] })), [1, 2, 4], content)
})

test('all needs every fragment, any one, and none is always seen', () => {
  const steps = [step(1000, 'alpha fragment one'), step(2000, 'x'), step(3000, 'x')]
  assert.deepEqual(kept(steps, seenRows({ all: ['alpha fragment one', 'beta fragment two'] })), [1, 4])
  assert.deepEqual(kept(steps, seenRows({ any: ['beta fragment two', 'alpha fragment one'] })), [1, 2, 4])
  assert.deepEqual(kept([step(1000, 'x'), step(2000, 'x'), step(3000, 'x')], seenRows({})), [1, 2, 3, 4, 5])
})

test('the step is the latest at or before the read, whatever the array order', () => {
  // Only entry 2 is a mount read here; its step is the one at 2000.
  const one = [{ idx: 2, at_ms: 2500, witness: { all: [WITNESS] } }]
  assert.deepEqual(kept([step(1000, 'x'), step(3000, 'x'), step(2000, WITNESS)], one), [1, 2, 3, 4, 5])
  const exact = [{ idx: 2, at_ms: 1100, witness: { all: [WITNESS] } }]
  assert.deepEqual(kept([step(1000, 'x'), step(1100, WITNESS), step(3000, 'x')], exact), [1, 2, 3, 4, 5])
})

test('a Codex trajectory as Harbor saved it credits the reads its step printed', () => {
  // Steps 4-6 of gpt-5.6-luna on erpbench-010: step 5 cats three mails and two Drive files in one code-mode exec.
  const codex = JSON.parse(readFileSync(new URL('codex-trajectory.json', import.meta.url), 'utf8'))
  const [before, issuing] = codex.steps.map((s: { timestamp: string }) => Date.parse(s.timestamp))
  const witnesses = [
    '"body_text":"**Northbridge Fastener Works · Toledo pl',
    'The Q2 batch is FILE-NBR-PRICE-BATCH-Q2. Policy: k',
    '"body_text":"From: marcus.lee@northbridge-sim.example',
    'PRICE-BATCH-NBR-2026Q2,1,FST-M8-40,0.89,2026-03-01',
    'FST-M8-40,M8 x 40 hex bolt, zinc,0.84,Active,2026-',
  ]
  const trace = witnesses.map((_, i) => entry(i + 1, 'google_drive.files.download', { fileId: `F${i}` }))
  const at = (ms: number): Seen[] => witnesses.map((w, i) => ({ idx: i + 1, at_ms: ms, witness: { all: [w] } }))
  assert.deepEqual(seenTrace(trace, at(issuing! + 100), codex, 0).map((e) => e.index), [1, 2, 3, 4, 5])
  assert.deepEqual(seenTrace(trace, at(before! + 100), codex, 0), [])
})

test('an oracle trajectory on the trial clock is moved to host time; a host agent is not', () => {
  const shift = 6 * 3600_000
  const steps = [step(1000 + shift, WITNESS), step(2000 + shift, 'x'), step(3000 + shift, 'x')]
  assert.deepEqual(kept(steps, seenRows(), shift, 'oracle'), [1, 2, 4])
  assert.deepEqual(kept(steps, seenRows(), shift, 'codex'), [1, 4])
})

test('a trajectory without an agent name is a host agent\'s', () => {
  const steps = [step(1000, WITNESS), step(2000, 'x'), step(3000, 'x')]
  assert.deepEqual(seenTrace(TRACE, seenRows(), { steps }, 6 * 3600_000).map((e) => e.index), [1, 2, 4])
})

test('mount reads with no usable trajectory fail; without mount reads none is needed', () => {
  for (const trajectory of [null, { steps: 'not steps' }, { steps: [{ ...step(1000, WITNESS), timestamp: undefined }] }])
    assert.throws(() => seenTrace(TRACE, seenRows(), trajectory, 0), /no timestamped agent step/)
  assert.deepEqual(seenTrace(TRACE, [], null, 0).map((e) => e.index), [1, 2, 3, 4, 5])
})

test("the manifest asks the fake for the grader's queries, in its order, and stages the trajectory", () => {
  for (const [task, spec] of Object.entries(MANIFEST.tasks)) {
    assert.deepEqual(spec.native_state.erpbench.queries, ['baseline', 'snapshot', 'trace', 'model', 'seen'], task)
    assert.ok(spec.inputs.includes('/logs/agent/trajectory.json'), task)
  }
})

test("flat matches convert.py's", { skip: !DOWNLOADED && 'run datasets/erpbench/download.py first' }, () => {
  const samples = ['Line 7,\r\nCA-PO', '\tTabbed  Text', 'Works · Toledo', 'say \\"hi\\"', 'literal \\n here', JSON.stringify(JSON.stringify('a "b" · c')), 'MiXeD CaSe', 'esc \\u00b7 dot']
  const run = spawnSync(
    PYTHON,
    ['-I', '-c', 'import json,sys; sys.path.insert(0, "datasets/erpbench"); from convert import flat; print(json.dumps([flat(s) for s in json.load(sys.stdin)], ensure_ascii=False))'],
    { input: JSON.stringify(samples), encoding: 'utf8' }
  )
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), samples.map(flat))
})

test('evaluate grades the trace the trajectory saw', { skip: !DOWNLOADED && 'run datasets/erpbench/download.py first' }, async () => {
  const REFERENCE = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TESTS)})
from erpbench100.evaluation import policy_steps, run_episode
from erpbench100.spec import world_model
t = json.load(open(${JSON.stringify(`${TESTS}/task.json`)}))
run = run_episode(t, policy_steps(t, "oracle"))
print(json.dumps({"model": world_model(t["tenant_code"]), "before": run["before"], "after": run["after"], "trace": run["trace"]}))
`
  const run = spawnSync(PYTHON, ['-I', '-c', REFERENCE], { encoding: 'utf8', maxBuffer: 1 << 30 })
  assert.equal(run.status, 0, run.stderr)
  const base = JSON.parse(run.stdout)
  // The oracle's own evidence for request_mail goes; one mount read of the mail, first, stands in for it.
  const requestMail = (e: any) =>
    (e.tool === 'gmail.messages.get' && e.arguments.id === 'MSG-erpbench-001-REQUEST') ||
    (e.tool === 'gmail.messages.list' && String(e.arguments.q ?? '').includes('erpbench-001'))
  const trace = [
    { index: 0, server: 'gmail', tool: 'gmail.messages.get', arguments: { id: 'MSG-erpbench-001-REQUEST' }, success: true, result: {} },
    ...base.trace.filter((e: any) => !requestMail(e)),
  ]
  const witness = '"body_text":"witness of the request mail'
  const json = (value: unknown) => [{ json: dumps(value) }]
  // An oracle's trajectory is on the trial clock, `epoch - host` ahead of the host's.
  const MOUNT_READ = JSON.stringify([{ idx: 0, at_ms: 1100, witness: { all: [witness] } }])
  type Case = { name?: string; shift?: number; raw?: string | null; host?: string; epoch?: string; seen?: string }
  const grade = async (shown: string, { name = 'codex', shift = 0, raw, host = new Date(0).toISOString(), epoch, seen = MOUNT_READ }: Case = {}) => {
    const trajectory = raw !== undefined ? raw : JSON.stringify({ agent: { name }, steps: [step(1000 + shift, shown)] })
    const result = await verify({
      dataset: 'erpbench',
      task: 'erpbench-001',
      states: {
        erpbench: {
          'query-0': json(base.before),
          'query-1': json(base.after),
          'query-2': json(trace),
          'query-3': json(base.model),
          'query-4': [{ json: seen }],
        },
      },
      files: {
        '/tests/task.json': Buffer.from(readFileSync(`${TESTS}/task.json`)).toString('base64'),
        ...(trajectory === null ? {} : { '/logs/agent/trajectory.json': Buffer.from(trajectory).toString('base64') }),
      },
      ...(epoch === '' ? {} : { epoch: epoch ?? new Date(shift).toISOString() }),
      host,
      timeoutSeconds: 120,
    })
    return result.checks['discovery:request_mail']
  }
  assert.equal(await grade(`shown: {${witness}}`), true)
  assert.equal(await grade('nothing shown'), false)
  assert.equal(await grade(`shown: {${witness}}`, { name: 'oracle', shift: 6 * 3600_000 }), true)
  // A mount read with no trajectory, or a broken one, is the harness's failure: the grade errors.
  await assert.rejects(grade('', { raw: null }), /no \/logs\/agent\/trajectory.json/)
  await assert.rejects(grade('', { raw: '{not json' }), /is not JSON/)
  // Without mount reads (nop) the trajectory is not read: none, or a broken one, still grades (the
  // stand-in read is then a CLI call, kept as upstream keeps it).
  assert.equal(await grade('', { raw: null, seen: '[]' }), true)
  assert.equal(await grade('', { raw: '{not json', seen: '[]' }), true)
  await assert.rejects(grade('', { seen: '{}' }), /Invalid ERPBench seen/)
  await assert.rejects(grade(`shown: {${witness}}`, { host: 'not a time' }), /Invalid clock/)
  await assert.rejects(grade(`shown: {${witness}}`, { epoch: '' }), /Invalid clock/)
})
