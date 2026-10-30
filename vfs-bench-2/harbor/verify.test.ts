/** Differential checks against the untouched Python graders, including partial scores. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import { CHAT_DB, CHAT_GRADERS } from './graders/chat.ts'
import { GRADERS } from './graders/index.ts'
import { verify, verifierWorkspace } from './verify.ts'

const HARBOR = import.meta.dirname
const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'
const SCHEMA = `
  CREATE TABLE user_sticker_pack (user_id INTEGER, sticker_pack_id INTEGER);
  CREATE TABLE user_sticker (user_id INTEGER, pack_id INTEGER, category TEXT);
  CREATE TABLE message (sender TEXT, message_kind TEXT, channel_id INTEGER);
`

// Only the DB path is redirected. The actual committed source executes as-is.
const REFERENCE = `
import contextlib, io, json, re, runpy, sqlite3, sys
source, database = sys.argv[1:]
connect = sqlite3.connect
def snapshot(path, *args, **kwargs):
    assert path == ${JSON.stringify(CHAT_DB)}, path
    return connect(database, *args, **kwargs)
sqlite3.connect = snapshot
out = io.StringIO()
with contextlib.redirect_stdout(out):
    try:
        runpy.run_path(source, run_name="__main__")
    except SystemExit:
        pass
score = re.search(r"Score:\\s*([0-9.]+)/1.0", out.getvalue())
assert score, out.getvalue()
print(json.dumps(float(score[1])))
`

function reference(task: string, database: string): number {
  const child = spawnSync(
    PYTHON,
    ['-I', '-c', REFERENCE, join(HARBOR, 'tasks/liveclawbench', task, 'tests/verify.py'), database],
    {
      encoding: 'utf8',
      timeout: 10_000,
    }
  )
  assert.equal(child.status, 0, child.error?.message ?? child.stderr)
  return JSON.parse(child.stdout)
}

function state(database: string, packs: number, channels: number, count: number, category: string | null) {
  const db = new DatabaseSync(database)
  db.exec(SCHEMA)
  for (const pack of [1, 2]) {
    if (packs & (1 << (pack - 1))) db.prepare('INSERT INTO user_sticker_pack VALUES (1, ?)').run(pack)
  }
  for (let i = 0; i < count; i++)
    db.prepare('INSERT INTO user_sticker VALUES (1, ?, ?)').run((i % 2) + 1, category)
  for (const channel of [2, 3]) {
    if (channels & (1 << (channel - 2)))
      db.prepare("INSERT INTO message VALUES ('You', 'sticker', ?)").run(channel)
  }
  // Rows which must not satisfy the original predicates.
  db.exec(`INSERT INTO user_sticker_pack VALUES (2, 1), (2, 2), (1, 3);
    INSERT INTO user_sticker VALUES (2, 2, 'favorite'), (1, 3, 'favorite');
    INSERT INTO message VALUES ('Other', 'sticker', 2), ('You', 'text', 3), ('You', 'sticker', 4);`)
  db.close()
}

test('the registered reference files match their pinned hashes', () => {
  const manifest = JSON.parse(readFileSync(join(HARBOR, 'graders/manifest.json'), 'utf8'))
  assert.equal(Object.keys(manifest).length, 70)
  assert.deepEqual(Object.keys(manifest).sort(), Object.keys(GRADERS).sort())
  for (const [task, spec] of Object.entries(manifest) as [
    string,
    { files: Record<string, string>; databases: string[] }
  ][]) {
    if (task in CHAT_GRADERS) assert.deepEqual(spec.databases, [CHAT_DB])
    for (const [file, hash] of Object.entries(spec.files)) {
      assert.equal(
        createHash('sha256')
          .update(readFileSync(join(HARBOR, 'tasks/liveclawbench', task, 'tests', file)))
          .digest('hex'),
        hash
      )
    }
  }
})

test('SQL ports match Python on empty, partial, complete, wrong-user and NULL states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-grade-parity-'))
  const seen = new Map(Object.keys(CHAT_GRADERS).map((task) => [task, new Set<number>()]))
  let index = 0
  try {
    // All pack/channel combinations, and every sticker-count threshold.
    const cases: [number, number, number, string | null][] = []
    for (let packs = 0; packs < 4; packs++) {
      for (let channels = 0; channels < 4; channels++) cases.push([packs, channels, 6, 'favorite'])
      for (const count of [0, 2, 3, 5, 7]) cases.push([packs, 3, count, 'favorite'])
    }
    cases.push([3, 3, 6, 'recent'], [3, 3, 6, null], [0, 0, 0, null])
    for (const [packs, channels, count, category] of cases) {
      const file = join(dir, `${index++}.sqlite`)
      state(file, packs, channels, count, category)
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        for (const [task, grade] of Object.entries(CHAT_GRADERS)) {
          const score = grade(db).score
          assert.equal(
            score,
            reference(task, file),
            `${task}: ${JSON.stringify({ packs, channels, count, category })}`
          )
          seen.get(task)!.add(score)
        }
      } finally {
        db.close()
      }
    }
    // Upstream's favorites check also counts other users' pack-1 rows.
    const file = join(dir, 'other-user.sqlite')
    state(file, 3, 3, 6, 'favorite')
    const db = new DatabaseSync(file)
    db.exec("INSERT INTO user_sticker VALUES (2, 1, 'recent')")
    assert.equal(
      CHAT_GRADERS['chat-sticker-engagement']!(db).score,
      reference('chat-sticker-engagement', file)
    )
    assert.equal(CHAT_GRADERS['chat-sticker-engagement']!(db).score, 0.5)
    db.close()
    for (const scores of seen.values()) assert.deepEqual([...scores].sort(), [0, 0.5, 1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fresh verifier workspaces have no Python/JS runtime or host file mounts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-grade-workspace-'))
  const database = join(dir, 'chat.sqlite')
  state(database, 3, 3, 6, 'favorite')
  const { workspace } = verifierWorkspace({
    task: 'chat-sticker-engagement',
    databases: { [CHAT_DB]: database },
    timeoutSeconds: 30,
  })
  const before = readFileSync(database)
  try {
    for (const command of [
      'python3 -c "print(1)"',
      'node -e "console.log(1)"',
      'cat /etc/passwd',
      `cat ${database}`,
      'grade --sql "DELETE FROM message"',
    ]) {
      const result = await workspace.shell(command)
      assert.notEqual(result.exitCode, 0, command)
    }
    const result = await workspace.shell('grade')
    assert.equal(result.exitCode, 0, result.stderrText)
    assert.equal(Number(result.stdoutText.trim()), 1)
    assert.deepEqual(readFileSync(database), before)
  } finally {
    await workspace.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('concurrent verifiers return their own rewards and errors produce no score', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-grade-runs-'))
  try {
    const full = join(dir, 'full.sqlite')
    const empty = join(dir, 'empty.sqlite')
    state(full, 3, 3, 6, 'favorite')
    state(empty, 0, 0, 0, 'favorite')
    const request = (file: string) => ({
      task: 'chat-sticker-engagement',
      databases: { [CHAT_DB]: file },
      timeoutSeconds: 30,
    })
    const results = await Promise.all([verify(request(full)), verify(request(empty))])
    assert.deepEqual(
      results.map((result) => result.score),
      [1, 0]
    )
    await assert.rejects(verify({ ...request(full), task: 'unported' }), /No Mirage grader/)
    await assert.rejects(verify(request(join(dir, 'missing.sqlite'))), /Grader failed/)
    writeFileSync(join(dir, 'bad.sqlite'), 'not a database')
    await assert.rejects(verify(request(join(dir, 'bad.sqlite'))), /Grader failed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
