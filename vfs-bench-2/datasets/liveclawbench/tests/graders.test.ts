/** Cross-language edge cases where a superficially similar JS port can drift. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addresses, round } from '../../../workspace/grader.ts'
import { iso } from '../graders/calendar.ts'
import { callJudge, plain } from '../graders/pkb.ts'
import { DatabaseError, table } from '../graders/sqlite.ts'

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

test('a column added with a DEFAULT reads it for rows stored before it, as SQLite does', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'vfsbench-sqlite-')), 'kb.db')
  const expected = python(
    [
      'import json,sqlite3,sys',
      'path = json.load(sys.stdin)',
      'db = sqlite3.connect(path)',
      'db.execute("CREATE TABLE sources (source_id TEXT, id TEXT)")',
      'db.executemany("INSERT INTO sources VALUES (?, ?)", [("source_09_note", "a"), ("source_01_paper", "b")])',
      'db.execute("ALTER TABLE sources ADD COLUMN reliability INTEGER DEFAULT 5")',
      'db.execute("ALTER TABLE sources ADD COLUMN note TEXT DEFAULT \'n/a\'")',
      'db.execute("ALTER TABLE sources ADD COLUMN extra")',
      'db.execute("INSERT INTO sources VALUES (?, ?, ?, ?, ?)", ("source_02_article", "c", 2, None, 7))',
      'db.commit()',
      'print(json.dumps(db.execute("SELECT * FROM sources").fetchall()))',
    ].join('\n'),
    path
  )
  const { rows } = table(new Uint8Array(readFileSync(path)), 'sources')
  assert.deepEqual(rows, expected)
})

test('a malformed record is a DatabaseError, not an allocation', () => {
  // A valid header and an empty sqlite_schema leaf whose one cell claims a
  // huge header and payload.
  const bytes = new Uint8Array(512)
  bytes.set(new TextEncoder().encode('SQLite format 3\0'))
  new DataView(bytes.buffer).setUint16(16, 512)
  bytes[18] = 1
  bytes[19] = 1
  bytes[21] = 64
  bytes[22] = 32
  bytes[23] = 32
  new DataView(bytes.buffer).setUint32(56, 1)
  bytes[100] = 0x0d
  new DataView(bytes.buffer).setUint16(103, 1)
  new DataView(bytes.buffer).setUint16(108, 400)
  bytes.set([0x82, 0x00, 0x01, 0xff, 0xff, 0xff, 0x7f], 400)
  const before = process.memoryUsage().heapUsed
  assert.throws(() => table(bytes, 'facts'), DatabaseError)
  assert.ok(process.memoryUsage().heapUsed - before < 4 * 1024 * 1024)
})

test('a saved judge debug keeps its raw reply', () => {
  const debug = { mode: 'chat_completions', raw_response: new Map([['choices', [new Map([['index', 0]])]]]) }
  assert.deepEqual(JSON.parse(JSON.stringify(plain(debug))), {
    mode: 'chat_completions',
    raw_response: { choices: [{ index: 0 }] },
  })
})

test('a canceled grade sends no judge request', async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(500).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as { port: number }).port
    const env = { JUDGE_BASE_URL: `http://127.0.0.1:${port}`, JUDGE_API_KEY: 'k' }
    const canceled = new AbortController()
    canceled.abort(new Error('grade canceled'))
    await assert.rejects(callJudge('s', 'u', env, undefined, canceled.signal), /grade canceled/)
    // Canceled mid-retry: the wait ends, and no request follows.
    const midway = new AbortController()
    const call = callJudge('s', 'u', env, undefined, midway.signal)
    await new Promise((resolve) => setTimeout(resolve, 300))
    midway.abort(new Error('grade canceled'))
    await assert.rejects(call, /grade canceled/)
    const seen = requests
    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.equal(requests, seen)
    assert.equal(seen, 1)
  } finally {
    server.close()
  }
})
