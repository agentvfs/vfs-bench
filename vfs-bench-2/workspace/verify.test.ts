/** Verifier workspace isolation, concurrency and host access. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import { CHAT_DB } from '../datasets/liveclawbench/graders/chat.ts'
import { sqliteTables } from './sqlite-tables.ts'
import { verify, verifierWorkspace } from './verify.ts'

const HERE = import.meta.dirname
const SCHEMA = `
  CREATE TABLE user_sticker_pack (user_id INTEGER, sticker_pack_id INTEGER);
  CREATE TABLE user_sticker (user_id INTEGER, pack_id INTEGER, category TEXT);
  CREATE TABLE message (sender TEXT, message_kind TEXT, channel_id INTEGER);
`

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

test('fresh verifier workspaces have no Python/JS runtime or host file mounts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-grade-workspace-'))
  const database = join(dir, 'chat.sqlite')
  state(database, 3, 3, 6, 'favorite')
  const { workspace } = await verifierWorkspace({
    dataset: 'liveclawbench', task: 'chat-sticker-engagement',
    states: { [CHAT_DB]: sqliteTables(database) },
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
      'sqlite3 /.verifier-state/0.json',
      'echo forged > /.verifier-state/0.json',
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
      dataset: 'liveclawbench',
      task: 'chat-sticker-engagement',
      states: { [CHAT_DB]: sqliteTables(file) },
      timeoutSeconds: 30,
    })
    const results = await Promise.all([verify(request(full)), verify(request(empty))])
    assert.deepEqual(
      results.map((result) => result.score),
      [1, 0]
    )
    await assert.rejects(verify({ ...request(full), task: 'unported' }), /No Mirage grader/)
    await assert.rejects(verify({ ...request(full), states: {} }), /Grader failed/)
    await assert.rejects(
      verify({ ...request(full), states: { [CHAT_DB]: { message: 'invalid' as any } } }),
      /Grader failed/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('native grading has no host filesystem, database, or subprocess imports', () => {
  // The TypeScript graders: LiveClawBench's and EnterpriseOps-Gym's.
  const datasets = join(HERE, '..', 'datasets')
  const sources = ['liveclawbench', 'enterpriseops'].flatMap((dataset) =>
    readdirSync(join(datasets, dataset, 'graders'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(datasets, dataset, 'graders', f))
  )
  for (const path of [...sources, join(HERE, 'grader.ts'), join(HERE, 'verify.ts')]) {
    const text = readFileSync(path, 'utf8')
    assert.doesNotMatch(
      text,
      /node:(?:fs|sqlite|child_process)|bun:sqlite|SELECT\s+.+?FROM|DatabaseSync/,
      path
    )
  }
})
