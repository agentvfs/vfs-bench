/**
 * EnterpriseOps-Gym's native grader against its Python reference
 * (enterpriseops_grade.py's `extract` and `compare`, upstream's), on the
 * cases a seeded run rarely reaches: floats against ints, bools, a str
 * against a number, `contains` on a float or a row, several rows, no rows,
 * and a query the runner refused. The native side runs end to end:
 * `verify` in a Mirage workspace, the rows through the VFS.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { verify } from './verify.ts'

const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'
const F = (v: number) => ({ __float__: v })

// [rows the fake answered, expected value, comparison]
const CASES: [unknown[], unknown, string][] = [
  [[{ c: 1 }], 1, 'equals'],
  [[{ c: F(1) }], 1, 'equals'],
  [[{ c: 1 }], true, 'equals'],
  [[{ c: 0 }], false, 'equals'],
  [[{ c: '1' }], 1, 'equals'],
  [[{ c: null }], 0, 'equals'],
  [[{ c: 'new' }], 'new', 'equals'],
  [[{ c: 2 }], 1, 'greater_than'],
  [[{ c: 1 }], 1, 'greater_than'],
  [[{ c: 'b' }], 'a', 'greater_than'],
  [[{ c: 2 }], '1', 'greater_than'],
  [[{ c: null }], 0, 'greater_than'],
  [[{ c: F(0.5) }], 1, 'less_than'],
  [[{ c: F(2.5) }], '2.5', 'contains'],
  [[{ c: F(3) }], '3.0', 'contains'],
  [[{ c: 3 }], '3.0', 'contains'],
  [[{ c: F(1e16) }], '1e+16', 'contains'],
  [[{ a: 1, b: 'x' }], "'b': 'x'", 'contains'],
  [[{ a: null, b: F(1.5) }], "{'a': None, 'b': 1.5}", 'contains'],
  [[{ c: 1 }, { c: 2 }], "[{'c': 1}, {'c': 2}]", 'contains'],
  [[{ c: 1 }, { c: 2 }], 2, 'equals'],
  [[], 0, 'equals'],
  [[], '[]', 'contains'],
  [[{ a: 'é', b: "it's" }], `{'a': 'é', 'b': "it's"}`, 'contains'],
  [[{ c: 5 }], 5, 'regex'],
  [[{ __error__: 'Query failed: no such table: x' }], 0, 'equals'],
]

const SERVER = 'sn-csm-server'

/** The reference's verdict on each case, from enterpriseops_grade.py itself. */
function reference(): boolean[] {
  const script = `
import json, sys
sys.path.insert(0, "harbor")
import enterpriseops_grade as g
def decode(v):
    if isinstance(v, list): return [decode(x) for x in v]
    if isinstance(v, dict):
        if "__float__" in v: return float(v["__float__"])
        return {k: decode(x) for k, x in v.items()}
    return v
out = []
for rows, expected, kind in json.load(sys.stdin):
    if len(rows) == 1 and "__error__" in rows[0]:
        out.append(False)
        continue
    actual = g.extract({"success": True, "result": {"data": decode(rows)}})
    out.append(g.compare(actual, expected, kind))
print(json.dumps(out))
`
  const run = spawnSync(PYTHON, ['-I', '-c', script], { input: JSON.stringify(CASES), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

test('the native EnterpriseOps-Gym grader compares as upstream does', async () => {
  const task = Object.keys(JSON.parse(readFileSync('harbor/graders/enterpriseops/manifest.json', 'utf8')).tasks)[0]!
  const verifiers = CASES.map(([, expected, kind], i) => ({
    verifier_type: 'database_state',
    name: `case ${i}`,
    gym_name: SERVER,
    validation_config: { query: `-- case ${i}`, expected_value: expected, comparison_type: kind },
  }))
  const states = { [SERVER]: Object.fromEntries(CASES.map(([rows], i) => [`query-${i}`, rows])) }
  const graded = await verify({
    task,
    states: states as any,
    files: { '/tests/verifiers.json': Buffer.from(JSON.stringify(verifiers)).toString('base64') },
    timeoutSeconds: 60,
  })
  const native = CASES.map((_, i) => graded.checks[`${i}:case ${i}`])
  const expected = reference()
  assert.ok(expected.some(Boolean) && !expected.every(Boolean), "the cases pass and fail both")
  assert.deepEqual(native, expected)
  assert.equal(graded.score, 0)
  assert.deepEqual(graded.rewards, { reward: 0, verifiers_passed: native.filter(Boolean).length, verifiers: CASES.length })
})
