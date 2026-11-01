/**
 * A run's SQLite file as Python's `sqlite3` module hands it to upstream's
 * servers, so a port of their code runs the same SQL to the same effect.
 *
 * - Transactions: a write (INSERT, UPDATE, DELETE, REPLACE) opens one if
 *   none is open, as Python 3.11's default isolation level does; `commit`
 *   ends it, and `close` without a commit rolls it back, so a tool that
 *   raises half way leaves nothing behind, as there. `executescript`
 *   commits first, then runs its script as it is.
 * - Values: an int binds as an INTEGER and a `PyFloat` as a REAL (node's
 *   own binding makes every number a REAL); a bool is 1 or 0. An INTEGER
 *   reads back as a number (a bigint past 2^53) and a REAL as a `PyFloat`.
 * - Strings: a double-quoted word that names no column is a string, as
 *   Python's SQLite build reads it.
 * - Time: SQLite's time functions read 'now' from the run's clock
 *   (mocks/upstream/instance.ts's `openRun`), and `CURRENT_TIMESTAMP` and
 *   its kin are those functions.
 */
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'

import { openRun } from '../../../liveclawbench/mocks/upstream/instance.ts'
import { PyFloat } from './py.ts'

export type Value = null | number | bigint | PyFloat | string | Uint8Array
/** A row as `sqlite3.Row`: its columns in order, by name. */
export type Row = Record<string, Value>
export type Params = readonly unknown[] | Record<string, unknown>

/** Python's `sqlite3.Error`s, by the class upstream's code catches. */
export class SqliteError extends Error {
  /** `IntegrityError`, `OperationalError` or the like. */
  readonly kind: string
  constructor(kind: string, message: string) {
    super(message)
    this.kind = kind
  }
}

/** A node:sqlite error as Python's sqlite3 raises it: its class and its message. */
function pythonError(error: unknown): SqliteError {
  const e = error as { message?: string; errcode?: number; errstr?: string }
  const message = (e.message ?? String(error)).replace(/^SQLITE_\w+: /, '')
  const code = (e.errcode ?? 0) & 0xff
  // SQLITE_CONSTRAINT 19, SQLITE_MISMATCH 20, SQLITE_RANGE 25.
  const kind = code === 19 ? 'IntegrityError' : code === 20 ? 'IntegrityError' : code === 25 ? 'ProgrammingError' : 'OperationalError'
  return new SqliteError(kind, message)
}

function bindable(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1n : 0n
  if (value instanceof PyFloat) return value.v
  if (typeof value === 'number') return Number.isInteger(value) ? BigInt(value) : value
  if (typeof value === 'bigint') {
    if (value > 2n ** 63n - 1n || value < -(2n ** 63n)) throw new SqliteError('OverflowError', 'Python int too large to convert to SQLite INTEGER')
    return value
  }
  if (typeof value === 'string') return value
  if (ArrayBuffer.isView(value)) return value as SQLInputValue
  throw new SqliteError('ProgrammingError', `Error binding parameter - probably unsupported type.`)
}

function readable(value: unknown): Value {
  if (typeof value === 'bigint') return value >= -(2n ** 53n) && value <= 2n ** 53n ? Number(value) : value
  if (typeof value === 'number') return new PyFloat(value)
  return value as Value
}

const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i

/** What `cursor.execute` leaves: the rows a statement returned, its counts. */
export class Cursor {
  private rows: Row[]
  private at = 0
  /** `cursor.lastrowid`: the last INSERT's row, else what it was. */
  readonly lastrowid: number | null
  /** `cursor.rowcount`: the rows a write changed, -1 for a query. */
  readonly rowcount: number
  /** `cursor.description`'s names. */
  readonly columns: string[]

  constructor(rows: Row[], columns: string[], lastrowid: number | null, rowcount: number) {
    this.rows = rows
    this.columns = columns
    this.lastrowid = lastrowid
    this.rowcount = rowcount
  }

  fetchone(): Row | null {
    return this.at < this.rows.length ? this.rows[this.at++]! : null
  }

  fetchall(): Row[] {
    const out = this.rows.slice(this.at)
    this.at = this.rows.length
    return out
  }
}

/** A connection to a run's file, as `sqlite3.connect` with `sqlite3.Row` makes one. */
export class Conn {
  readonly db: DatabaseSync
  private open = false
  private lastrowid: number | null = null

  constructor(file: string, now: () => number) {
    // Python's sqlite3 takes a double-quoted word that names no column as a
    // string (`status = "open"`), as SQLite does by default; node's turns
    // that off. Upstream's verifiers rely on it.
    this.db = openRun(file, now, { enableDoubleQuotedStringLiterals: true })
  }

  /** `conn.execute(sql, params)`. */
  execute(sql: string, params: Params = []): Cursor {
    if (WRITE.test(sql) && !this.open) this.begin()
    if (/^\s*BEGIN\b/i.test(sql)) {
      this.begin()
      return new Cursor([], [], this.lastrowid, -1)
    }
    if (/^\s*(COMMIT|END)\b/i.test(sql)) {
      this.commit()
      return new Cursor([], [], this.lastrowid, -1)
    }
    if (/^\s*ROLLBACK\s*;?\s*$/i.test(sql)) {
      this.rollback()
      return new Cursor([], [], this.lastrowid, -1)
    }
    let statement: StatementSync
    try {
      statement = this.db.prepare(rewrite(sql))
    } catch (error) {
      throw pythonError(error)
    }
    statement.setReadBigInts(true)
    const columns = statement.columns().map((c) => c.name)
    try {
      if (columns.length > 0) {
        const raw = Array.isArray(params)
          ? (statement.all(...(params as unknown[]).map(bindable)) as Record<string, unknown>[])
          : (statement.all(named(params as Record<string, unknown>)) as Record<string, unknown>[])
        const rows = raw.map((r) => {
          const row: Row = {}
          for (const c of columns) row[c] = readable(r[c])
          return row
        })
        return new Cursor(rows, columns, this.lastrowid, -1)
      }
      const result = Array.isArray(params)
        ? statement.run(...(params as unknown[]).map(bindable))
        : statement.run(named(params as Record<string, unknown>))
      if (/^\s*(INSERT|REPLACE)\b/i.test(sql)) this.lastrowid = Number(result.lastInsertRowid)
      return new Cursor([], [], this.lastrowid, WRITE.test(sql) ? Number(result.changes) : -1)
    } catch (error) {
      throw pythonError(error)
    }
  }

  /** `conn.executescript(sql)`: commits first, then runs the script as it is. */
  executescript(sql: string): void {
    this.commit()
    try {
      this.db.exec(rewrite(sql))
    } catch (error) {
      throw pythonError(error)
    }
  }

  begin(): void {
    if (this.open) return
    this.db.exec('BEGIN')
    this.open = true
  }

  commit(): void {
    if (!this.open) return
    this.db.exec('COMMIT')
    this.open = false
  }

  rollback(): void {
    if (!this.open) return
    this.db.exec('ROLLBACK')
    this.open = false
  }

  /** `conn.close()`: what was not committed is rolled back. */
  close(): void {
    try {
      this.rollback()
    } finally {
      this.db.close()
    }
  }
}

function named(params: Record<string, unknown>): Record<string, SQLInputValue> {
  const out: Record<string, SQLInputValue> = {}
  for (const [k, v] of Object.entries(params)) out[k] = bindable(v)
  return out
}

/** `CURRENT_TIMESTAMP` and its kin as the time functions, which read the run's clock. */
function rewrite(sql: string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\bCURRENT_TIMESTAMP\b/gi, "(datetime('now'))")
            .replace(/\bCURRENT_DATE\b/gi, "(date('now'))")
            .replace(/\bCURRENT_TIME\b/gi, "(time('now'))"),
    )
    .join('')
}

/** A row's value by position, as `row[i]`. */
export function at(row: Row, i: number): Value {
  return Object.values(row)[i] ?? null
}
