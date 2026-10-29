/**
 * The social fake's fixture for a task: upstream's social seed
 * (mocks/social/src/db.ts, which seeds as its `getDb()` first opens the
 * database), with the task's own seed where its image has one, as its rows.
 *
 * Upstream's image puts the task's `environment/seed.json` at
 * `/opt/mock/data/seed.json` (its `assets` in task-binary-map.json), which
 * the seed loads after its own rows ("Layer 1"). Here it is put where the
 * seed looks first, `$MOCK_DATA_DIR/seed.json`. A task with a legacy startup
 * script then gets the rows the script adds to the social mock
 * (`startup.ts`).
 *
 * The seed runs as it is, but for SQLite's `datetime('now')`, which its
 * columns' defaults stamp each row with: it reads the epoch, as `Date` does
 * (frozen.ts, as compare.ts runs upstream's mock).
 *
 * The fixture also states the run's `TASK_NAME` in `_env`, the fake's own
 * table: upstream's mock reads it from its environment for its two faults,
 * and the fake every task of a job shares has no environment of the task's.
 */
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startupSql } from './startup.ts'

/** Upstream's tables, parents first, so each row's references exist. */
const TABLES = [
  'account',
  'post',
  'post_asset',
  'tag',
  'post_tag',
  'post_action_log',
  'comment',
  'follow_relation',
  'keyword_rule',
  'post_metric',
  'event_campaign',
  'post_like',
  'post_repost',
]

/** Where upstream's image puts the task's seed.json, and the mock's fallback for it. */
const IMAGE_SEED = '/opt/mock/data/seed.json'

/** The task's seed.json, as its image's `assets` place it, if any. */
function seedJson(platform: string, task: string): string | undefined {
  const map = JSON.parse(readFileSync(join(platform, 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, { assets?: { src: string; dest: string }[] }>
  }
  const asset = map.tasks[task]?.assets?.find((a) => a.dest === IMAGE_SEED)
  return asset === undefined ? undefined : join(platform, '..', asset.src)
}

export async function social(platform: string, task: string, epoch: string): Promise<Record<string, unknown[]>> {
  // The mock falls back to the image's path; one on this host would be read.
  if (existsSync(IMAGE_SEED)) throw new Error(`${IMAGE_SEED} exists here, which upstream's seed would read`)
  process.env.FROZEN_EPOCH = epoch
  await import('./frozen.ts')
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-social-seed-'))
  const seed = seedJson(platform, task)
  if (seed !== undefined) copyFileSync(seed, join(dir, 'seed.json'))
  // db.ts takes its path from the environment as it loads.
  process.env.MOCK_DATA_DIR = dir
  const { getDb } = (await import(join(platform, 'mocks', 'social', 'src', 'db.ts'))) as { getDb: () => Database }
  // The seed logs to stdout, which is the fixture's.
  const log = console.log
  console.log = (...args: unknown[]) => console.error(...args)
  let db: Database
  try {
    db = getDb()
  } finally {
    console.log = log
  }
  for (const sql of startupSql(platform, task, 'social')) db.run(sql)
  const out: Record<string, unknown[]> = { _env: [{ name: 'TASK_NAME', value: task }] }
  for (const table of TABLES) {
    out[table] = db.query(`SELECT * FROM "${table}" ORDER BY rowid`).all()
    // The kit seeds each row with its own id, which leaves the table's
    // AUTOINCREMENT counter at the largest; upstream's must be there too.
    const seq = db.query('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | null
    const max = db.query(`SELECT MAX(rowid) AS max FROM "${table}"`).get() as { max: number | null }
    if ((seq?.seq ?? null) !== max.max) {
      throw new Error(`${table}: upstream's next id follows ${seq?.seq ?? 'nothing'}, not its largest, ${max.max ?? 'none'}`)
    }
  }
  db.close()
  rmSync(dir, { recursive: true, force: true })
  return out
}
