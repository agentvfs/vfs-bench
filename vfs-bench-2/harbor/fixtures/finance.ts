/**
 * The finance fake's fixture for a task: upstream's finance seed
 * (mocks/finance/src/db: `runMigrations`, `seed` and `seedV2`, as its app's
 * `seed()` runs them), with the task's own seed SQL where its Dockerfile
 * names one (`ENV MOCK_FINANCE_SEED_SQL`), as its rows.
 *
 * The seed runs as it is, but for two things it reads besides `Date`:
 * SQLite's `datetime('now')`, which upstream's column defaults stamp each
 * row with, reads the epoch, and `crypto.getRandomValues`, which salts each
 * password hash, is a counter's. So the fixture is the same on every run.
 *
 * The fixture also states the run's `TASK_NAME` in `_env`, the fake's own
 * table: upstream's mock reads it from its environment, and the fake every
 * task of a job shares has no environment of the task's.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/** Upstream's tables, parents first, so each row's references exist. */
const TABLES = [
  '_migrations',
  'user',
  'department_financial_record',
  'system_config',
  'transaction_record',
  'account_balance',
  'account_transaction',
  'vendor',
  'expense_report',
  'expense_item',
  'invoice',
  'invoice_line_item',
  'asset_record',
  'budget_alert',
  'dashboard_config',
  'portfolio_holding',
  'portfolio_order',
]

/** A bun:sqlite database whose `datetime('now')` is the epoch's. */
function frozen(file: string, epoch: string): Database {
  const now = `datetime('${new Date(epoch).toISOString().slice(0, 19).replace('T', ' ')}')`
  const freeze = (sql: string) => sql.replace(/datetime\(\s*'now'\s*\)/gi, now)
  class FrozenDatabase extends Database {
    override run(sql: string, ...params: never[]) {
      return super.run(freeze(sql), ...params)
    }

    override exec(sql: string, ...params: never[]) {
      return super.exec(freeze(sql), ...params)
    }

    override query(sql: string) {
      return super.query(freeze(sql))
    }

    override prepare(sql: string, ...params: never[]) {
      return super.prepare(freeze(sql), ...params)
    }
  }
  return new FrozenDatabase(file, { create: true })
}

/** The seed SQL file the task's Dockerfile names, in its task directory, if any. */
function seedSql(task: string): string | undefined {
  const dockerfile = readFileSync(join(task, 'environment', 'Dockerfile'), 'utf8')
  const value = /^ENV\s+MOCK_FINANCE_SEED_SQL[=\s]+(\S+)\s*$/m.exec(dockerfile)?.[1]
  if (value === undefined) return undefined
  // The image has the task's environment/ at the directory `COPY .` names.
  const copied = /^COPY\s+\.\s+(\S+?)\/?\s*$/m.exec(dockerfile)?.[1]
  if (copied === undefined || !value.startsWith(`${copied}/`)) {
    throw new Error(`MOCK_FINANCE_SEED_SQL=${value} is not under the directory the Dockerfile copies environment/ to`)
  }
  return join(task, 'environment', value.slice(copied.length + 1))
}

export async function finance(mock: string, task: string, epoch: string): Promise<Record<string, unknown[]>> {
  let counted = 0
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    value: <T extends ArrayBufferView>(array: T): T => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (let i = 0; i < bytes.length; i += 32) {
        bytes.set(createHash('sha256').update(`finance-seed-${++counted}`).digest().subarray(0, bytes.length - i), i)
      }
      return array
    },
  })
  const sql = seedSql(task)
  if (sql !== undefined) process.env.MOCK_FINANCE_SEED_SQL = sql
  else delete process.env.MOCK_FINANCE_SEED_SQL

  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-finance-seed-'))
  const { runMigrations } = (await import(join(mock, 'src', 'db', 'migrate.ts'))) as { runMigrations: (db: Database) => void }
  const { seed } = (await import(join(mock, 'src', 'db', 'seed.ts'))) as { seed: (db: Database) => void }
  const { seedV2 } = (await import(join(mock, 'src', 'db', 'seed-v2.ts'))) as { seedV2: (db: Database) => void }
  const db = frozen(join(dir, 'finance_app.sqlite'), epoch)
  // As upstream's createDbState opens it.
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  runMigrations(db)
  seed(db)
  seedV2(db)
  const out: Record<string, unknown[]> = { _env: [{ name: 'TASK_NAME', value: basename(task) }] }
  for (const table of TABLES) {
    out[table] = db.query(`SELECT * FROM "${table}" ORDER BY rowid`).all()
    // The kit seeds each row with its own id, which leaves the table's
    // AUTOINCREMENT counter at the largest; upstream's must be there too.
    const seq = db.query('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | null
    const max = db.query(`SELECT MAX(rowid) AS max FROM "${table}"`).get() as { max: number | null }
    if (table !== '_migrations' && (seq?.seq ?? null) !== max.max) {
      throw new Error(`${table}: upstream's next id follows ${seq?.seq ?? 'nothing'}, not its largest, ${max.max ?? 'none'}`)
    }
  }
  db.close()
  rmSync(dir, { recursive: true, force: true })
  return out
}
