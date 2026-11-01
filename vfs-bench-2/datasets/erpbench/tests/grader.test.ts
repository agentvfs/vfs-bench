/**
 * ERPBench-100's native grader against upstream's `score_episode`, on the
 * end states upstream's policies never reach (compare.py covers
 * those): an answer within or past 0.005, as a str, a bool or None; the
 * draft's figures grouped or to two places, the option and status by label;
 * a register row at the wrong place, short, or of strs; an immutable or an
 * out-of-scope table changed, the draft gone, a second record under a new
 * key; and values upstream raises on, `NaN` included. One oracle run per
 * workflow family is the base; each case changes it, and both graders must
 * give the same reward and checks, or both raise.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { test } from 'node:test'

import { PyFloat } from '../../../workspace/py.ts'
import { type Row } from '../../../workspace/grader.ts'
import { scoreEpisode } from '../graders/index.ts'
import MANIFEST from '../graders/manifest.json' with { type: 'json' }
import { deepcopy, dumps, pyLoads } from '../mocks/erpbench/py.ts'

const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'
const TESTS = 'state/erpbench/src/benchmark/erpbench100/release/harbor/tasks/erpbench-001/tests'
const TASKS = Array.from({ length: 10 }, (_, i) => `erpbench-${String(i + 1).padStart(3, '0')}`)

const REFERENCE = `
import json, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(TESTS)})
from erpbench100.evaluation import policy_steps, run_episode, score_episode
from erpbench100.spec import world_model
tasks = Path(${JSON.stringify(TESTS)}).parent.parent
def task(name):
    return json.loads((tasks / name / "tests" / "task.json").read_text())
out = []
if sys.argv[1] == "base":
    for name in json.load(sys.stdin):
        t = task(name)
        run = run_episode(t, policy_steps(t, "oracle"))
        out.append({"task": t, "model": world_model(t["tenant_code"]), "before": run["before"], "after": run["after"], "trace": run["trace"]})
else:
    for case in json.load(sys.stdin):
        try:
            v = score_episode(task(case["task"]), case["before"], case["after"], case["trace"])
            out.append({"score": v["reward"], "checks": {c["id"]: c["passed"] for c in v["checks"]}})
        except Exception as e:
            out.append({"error": type(e).__name__})
print(json.dumps(out))
`

function python(mode: string, input: unknown): any {
  const run = spawnSync(PYTHON, ['-I', '-c', REFERENCE, mode], { input: dumps(input), encoding: 'utf8', maxBuffer: 1 << 30 })
  assert.equal(run.status, 0, run.stderr)
  // The bases keep Python's floats; a score is a plain number either side.
  return mode === 'base' ? pyLoads(run.stdout) : JSON.parse(run.stdout)
}

interface Base {
  task: Row
  model: Row
  before: Row
  after: Row
  trace: Row[]
}

const F = (v: number) => new PyFloat(v)
const num = (v: any) => (v instanceof PyFloat ? v.v : Number(v))
const mine = (rows: any[], id: string) => rows.filter((r) => r.task_id === id || r.last_task_id === id)
const fieldsOf = (b: Base) => (MANIFEST.constants.numeric_fields as Record<string, string[]>)[b.task.metadata.category]!
/** Python's `f"{v:,}"`: a float keeps its ".0". */
const grouped = (v: any) => num(v).toLocaleString('en-US', { minimumFractionDigits: v instanceof PyFloat ? 1 : 0, maximumFractionDigits: 17 })
const register = (b: Base) => mine(b.after.sheet_changes, b.task.task_id).filter((c) => String(c.cell_range).startsWith('Register'))

const answer = (name: string, change: (v: any) => unknown): [string, (b: Base) => void] => [
  name,
  (b) => {
    const answers = mine(b.after.submissions, b.task.task_id)[0].answers
    const field = fieldsOf(b)[3]!
    answers[field] = change(answers[field])
  },
]

const draft = (name: string, format: (v: any) => string): [string, (b: Base) => void] => [
  name,
  (b) => {
    const e = b.task.expected_answer
    const figures = fieldsOf(b).map((f) => format(e[f])).join(', ')
    mine(b.after.mail_drafts, b.task.task_id)[0].body = `${e.primary_record}: ${e.recommended_option}. ${figures}.`
  },
]

/** Each case: a name, and the change it makes to an oracle end state (a copy), or false where it does not apply. */
const CASES: [string, (b: Base) => boolean | void][] = [
  ['oracle as it is', () => {}],
  answer('an answer 0.004 off', (v) => F(num(v) + 0.004)),
  answer('an answer 0.006 off', (v) => F(num(v) + 0.006)),
  answer('an answer as a str', (v) => num(v).toFixed(2)),
  answer('an answer as a currency str', (v) => `$${num(v)}`),
  answer('an answer as True', () => true),
  answer('an answer as None', () => null),
  draft('the draft with grouped figures', grouped),
  [
    'the draft with two small figures, the large ones grouped',
    (b) => {
      const e = b.task.expected_answer
      const values = fieldsOf(b).map((f) => e[f])
      const small = values.filter((v) => Math.abs(num(v)) < 1000).slice(0, 2)
      const large = values.filter((v) => Math.abs(num(v)) >= 1000)
      if (!large.length) return false
      const figures = [...small.map((v) => String(num(v))), ...large.map(grouped)].join(', ')
      mine(b.after.mail_drafts, b.task.task_id)[0].body = `${e.primary_record}: ${e.recommended_option}. ${figures}.`
    },
  ],
  draft('the draft with figures to two places', (v) => num(v).toFixed(2)),
  draft('the draft with figures as ints', (v) => String(Math.round(num(v)))),
  [
    'the draft naming the option by label, two figures',
    (b) => {
      const e = b.task.expected_answer
      const label = b.task.decision_options.find((o: Row) => o.id === e.recommended_option).label
      const figures = fieldsOf(b).slice(0, 2).map((f) => num(e[f]))
      mine(b.after.mail_drafts, b.task.task_id)[0].body = `${e.primary_record}: ${label}. ${figures.join(', ')}.`
    },
  ],
  [
    'the post naming the status by label',
    (b) => {
      const e = b.task.expected_answer
      const label = b.task.status_options.find((o: Row) => o.id === e.decision_status).label
      mine(b.after.chat_posts, b.task.task_id)[0].text = `Handoff: ${label}.`
    },
  ],
  ['the register row a row lower', (b) => void register(b).forEach((c) => (c.cell_range = c.cell_range.replace(/\d+/g, (d: string) => String(+d + 1))))],
  ['the register on another sheet', (b) => void register(b).forEach((c) => (c.spreadsheet_id = 'SHEET-OTHER'))],
  ['the register row appended', (b) => void register(b).forEach((c) => ((c.operation = 'append'), (c.cell_range = 'Register!A:H')))],
  ['the register row short', (b) => void register(b).forEach((c) => (c.values = c.values.map((r: any[]) => r.slice(0, 5))))],
  [
    'the register row as strs',
    (b) => void register(b).forEach((c) => (c.values = c.values.map((r: any[]) => r.map((x) => (x instanceof PyFloat ? String(x.v) : x))))),
  ],
  ['an immutable table changed', (b) => void (b.after.tenants[0].name += ' (renamed)')],
  ['an out-of-scope table changed', (b) => void (b.after.onhand_balances[0].on_hand = num(b.after.onhand_balances[0].on_hand) + 1)],
  ['the draft gone', (b) => void (b.after.mail_drafts = b.after.mail_drafts.filter((r: Row) => r.task_id !== b.task.task_id))],
  [
    'a second record under a new key',
    (b) => {
      for (const table of (MANIFEST.constants.family_write_tables as Record<string, string[]>)[b.task.metadata.category]!) {
        const row = mine(b.after[table], b.task.task_id)[0]
        if (!row) continue
        const copy = deepcopy(row)
        const [key] = Object.keys(copy)
        copy[key!] = typeof copy[key!] === 'string' ? `${copy[key!]}-2` : num(copy[key!]) + 100000
        for (const k of ['order_number', 'source_transaction_number', 'receipt_number', 'requisition_number', 'invoice_number'])
          if (typeof copy[k] === 'string') copy[k] += '-2'
        b.after[table].push(copy)
        return
      }
      return false
    },
  ],
  [
    'an order line priced NaN',
    (b) => {
      const order = mine(b.after.sales_orders, b.task.task_id)[0]
      if (!order?.lines?.length) return false
      order.lines[0].UnitListPrice = F(NaN)
    },
  ],
  [
    'a requisition line naming a list',
    (b) => {
      const row = mine(b.after.purchase_requisitions, b.task.task_id)[0]
      if (!row?.lines?.length) return false
      row.lines[0].ItemNumber = ['SKU']
    },
  ],
  [
    'a hold with no reason',
    (b) => {
      const invoice = mine(b.after.ap_invoices, b.task.task_id)[0]
      const holds = invoice ? b.after.invoice_holds.filter((h: Row) => h.invoice_id === invoice.invoice_id) : []
      if (!holds.length) return false
      holds[0].hold_reason = null
    },
  ],
  [
    'a receipt applying a str amount',
    (b) => {
      const receipt = mine(b.after.standard_receipts, b.task.task_id)[0]
      if (!receipt?.remittance_references?.length) return false
      receipt.remittance_references[0].ApplyAmount = String(num(receipt.remittance_references[0].ApplyAmount))
    },
  ],
]

test('pyLoads reads json.dumps output, NaN and Infinity included', () => {
  const [nan, inf, ninf, one, text, big] = pyLoads<any[]>('[NaN, Infinity, -Infinity, 1.0, "NaN, Infinity", 9007199254740993]')
  assert.ok(Number.isNaN(nan.v) && inf.v === Infinity && ninf.v === -Infinity)
  assert.ok(one instanceof PyFloat && one.v === 1)
  assert.equal(text, 'NaN, Infinity')
  assert.equal(big, 9007199254740993n)
})

test(
  'the native ERPBench-100 grader scores as upstream does',
  { skip: !existsSync(TESTS) && 'run datasets/erpbench/fetch.py first' },
  () => {
    const bases: Base[] = python('base', TASKS)
    assert.equal(new Set(bases.map((b) => b.task.metadata.category)).size, 10, 'one task per workflow family')
    const cases: { name: string; state: Base }[] = []
    for (const base of bases)
      for (const [name, change] of CASES) {
        const state = deepcopy(base)
        if (change(state) !== false) cases.push({ name: `${base.task.task_id} ${name}`, state })
      }
    const expected = python(
      'score',
      cases.map(({ state }) => ({ task: state.task.task_id, before: state.before, after: state.after, trace: state.trace }))
    )
    const native = cases.map(({ state }) => {
      try {
        const grade = scoreEpisode(state.task, state.model, state.before, state.after, state.trace)
        return { score: grade.score, checks: grade.checks }
      } catch (error) {
        return { error: error instanceof Error ? error.constructor.name : String(error) }
      }
    })
    const scores = new Set(expected.map((v: any) => v.score))
    assert.ok(scores.has(1) && scores.size > 3 && expected.some((v: any) => v.error), 'the cases pass, fail and raise')
    cases.forEach(({ name }, i) => {
      const [want, got] = [expected[i], native[i]]
      if (want.error) assert.ok(got.error, `${name}: upstream raises ${want.error}, native gives ${got.score}`)
      else assert.deepEqual(got, want, name)
    })
  }
)
