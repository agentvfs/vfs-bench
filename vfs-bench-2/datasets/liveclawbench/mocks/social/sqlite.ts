/**
 * The database upstream's handlers see: bun:sqlite's `Database`, the part of
 * it they call (`query(sql).get/all/run`, `prepare(sql).get/all/run`), over
 * node:sqlite on the run's file, one connection per request.
 *
 * Upstream registers its routes with one `getDb()` taken at start. Here that
 * is `getDb()` below: one object for every run, which answers with the
 * connection of the request it is called in (`request()`, an
 * AsyncLocalStorage).
 *
 * The connection answers SQLite's `datetime('now')`, in a statement or a
 * column's default, with the request's time: the run's frozen clock a tick
 * ahead. A request that changes a row moves the clock that tick (`app.ts`),
 * so each write is a second after the one before, as the kit's fakes stamp
 * writes; one that only reads leaves it. Parameters bind as bun:sqlite binds
 * them: `true` as 1, `undefined` as NULL, a first argument that is an array
 * as the list and one that is an object as named bindings, which `?` never
 * names.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'

/** What one request of upstream's handlers runs with. */
export interface Request {
  db: Database
  /** The request's time, in ms: the run's clock a tick ahead. */
  nowMs: number
  /** The run's `TASK_NAME`, from its fixture's `_env`. */
  taskName: string
  /** The run's session secret and fired faults (session.ts). */
  run: RunMemory
}

export interface RunMemory {
  /** mock-lib's `generateSecret()`: 64 random bytes, as hex. */
  secret: string
  /** The faults that have fired. */
  fired: Set<string>
}

const requests = new AsyncLocalStorage<Request>()

/** Run `work` as one request of upstream's handlers. */
export function within<T>(request: Request, work: () => T): T {
  return requests.run(request, work)
}

/** The request being answered. */
export function request(): Request {
  const found = requests.getStore()
  if (found === undefined) throw new Error('the social mock touched its database outside a request')
  return found
}

/** SQLite's `datetime('now')` form of a time. */
export function sqliteTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

const BINDING = 'Binding expected string, TypedArray, boolean, number, bigint or null'

function bindable(value: unknown): SQLInputValue {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' && Number.isNaN(value)) return null
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  if (ArrayBuffer.isView(value)) return value as SQLInputValue
  throw new TypeError(BINDING)
}

/** bun:sqlite's reading of a statement's arguments, as node:sqlite's. */
function bindings(sql: string, args: unknown[]): SQLInputValue[] {
  const first = args[0]
  if (Array.isArray(first)) return first.map(bindable)
  if (typeof first === 'object' && first !== null && !ArrayBuffer.isView(first)) {
    // Named bindings: no `?` is named, so each is NULL.
    return Array.from(sql.matchAll(/\?/g), () => null)
  }
  return args.map(bindable)
}

/** A row as bun:sqlite hands it: a plain object. */
const plain = (row: unknown) => (row === undefined ? null : { ...(row as object) })

class Statement {
  private readonly statement: StatementSync
  private readonly sql: string

  constructor(statement: StatementSync, sql: string) {
    this.statement = statement
    this.sql = sql
  }

  get(...args: unknown[]) {
    return plain(this.statement.get(...bindings(this.sql, args)))
  }

  all(...args: unknown[]) {
    return this.statement.all(...bindings(this.sql, args)).map(plain)
  }

  run(...args: unknown[]) {
    const done = this.statement.run(...bindings(this.sql, args))
    return { lastInsertRowid: done.lastInsertRowid, changes: done.changes }
  }
}

/** bun:sqlite's `Database`, as far as upstream's handlers use it. */
export class Database {
  private readonly connection: DatabaseSync

  constructor(connection: DatabaseSync) {
    this.connection = connection
  }

  query(sql: string): Statement {
    return new Statement(this.connection.prepare(sql), sql)
  }

  prepare(sql: string): Statement {
    return this.query(sql)
  }

  exec(sql: string): void {
    this.connection.exec(sql)
  }

  /** Whether this connection has changed a row. */
  changed(): boolean {
    return (this.connection.prepare('SELECT total_changes() AS n').get() as { n: number }).n > 0
  }

  close(): void {
    this.connection.close()
  }
}

/** A connection with SQLite's own `datetime`, for the forms other than 'now'. */
let builtIn: DatabaseSync | undefined

/**
 * The run's file, opened for one request: foreign keys on, as upstream's
 * `getDb()` sets them, and `datetime('now')` the request's time. Any other
 * `datetime(...)` is SQLite's own.
 */
export async function open(file: string, nowMs: number): Promise<Database> {
  // Imported here: node:sqlite warns that it is experimental on import.
  const { DatabaseSync } = await import('node:sqlite')
  const connection = new DatabaseSync(file)
  const now = sqliteTime(nowMs)
  connection.function('datetime', { varargs: true, deterministic: false }, (...args) => {
    if (args.length === 1 && args[0] === 'now') return now
    builtIn ??= new DatabaseSync(':memory:')
    const marks = args.map(() => '?').join(', ')
    return (builtIn.prepare(`SELECT datetime(${marks}) AS v`).get(...args) as { v: string | null }).v
  })
  connection.exec('PRAGMA foreign_keys = ON')
  return new Database(connection)
}

/** Upstream's `getDb()`: the database of whichever request calls it. */
export function getDb(): Pick<Database, 'query' | 'prepare' | 'exec'> {
  return {
    query: (sql) => request().db.query(sql),
    prepare: (sql) => request().db.prepare(sql),
    exec: (sql) => request().db.exec(sql),
  }
}
