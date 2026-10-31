/** Cross-language edge cases where a superficially similar JS port can drift. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { addresses, round } from './graders/context.ts'
import { iso } from './graders/calendar.ts'

const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'

function python(source: string, value: unknown) {
  const r = spawnSync(PYTHON, ['-I', '-c', source], {
    input: JSON.stringify(value),
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('rounding preserves Python ties and binary-float decimal boundaries', () => {
  const values = [
    -2.675, -1.5, -0.125, 0, 0.045, 0.125, 0.15, 0.25, 0.35, 0.45, 0.575, 0.625, 0.675, 1.005, 1.225, 2.675,
    12.345,
  ]
  const cases = values.flatMap((n) => [-1, 0, 1, 2, 3, 4].map((d) => [n, d]))
  const expected = python(
    'import json,sys\nprint(json.dumps([round(v,d) for v,d in json.load(sys.stdin)]))',
    cases
  )
  assert.deepEqual(
    cases.map(([n, d]) => round(n!, d)),
    expected
  )
})
test('calendar instants match Python UTC, offsets, IANA zones and DST fold=0', () => {
  const cases = [
    ['2026-05-26T14:00:00', null],
    ['2026-05-26T10:00:00', 'America/New_York'],
    ['2026-05-26T22:00:00+08:00', null],
    ['2026-03-08T02:30:00', 'America/New_York'],
    ['2026-11-01T01:30:00', 'America/New_York'],
    ['2026-05-26T14:00:00.000001', 'UTC'],
    ['2026-02-30T14:00:00', null],
    ['2026-05-26T14:00:00', 'Invalid/Zone'],
  ]
  const expected = python(
    `import json,sys
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
out=[]
for value,zone in json.load(sys.stdin):
 try:
  d=datetime.fromisoformat(value.replace('Z','+00:00'))
  if d.tzinfo is None:d=d.replace(tzinfo=ZoneInfo(zone) if zone else timezone.utc)
  out.append(d.timestamp()*1000)
 except Exception:out.append(None)
print(json.dumps(out))`,
    cases
  )
  assert.deepEqual(
    cases.map(([s, z]) => iso(s, z)),
    expected
  )
})
test('mailbox parsing preserves addresses, groups, quoted names and case', () => {
  const cases = [
    ['a@example.com'],
    ['"Smith, Alex" <Alex@example.com>, Bob <b@example.com>'],
    ['Team: alice@example.com, bob@example.com;'],
    ['Alice (team (internal)) <alice@example.com>'],
    ['alice@example.com', 'b@example.com'],
    ['"O\\"Connor" <alice@example.com>'],
  ]
  const expected = python(
    'import json,sys\nfrom email.utils import getaddresses\nprint(json.dumps([[a for _,a in getaddresses(h)] for h in json.load(sys.stdin)]))',
    cases
  )
  assert.deepEqual(cases.map(addresses), expected)
})
