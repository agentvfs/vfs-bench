/**
 * What an upstream LiveClawBench mock reads from its process and its disk,
 * for one run (fake.ts). It is bundled into every copy of the mock, so each
 * run's copy has its own, as each trial's process has upstream.
 *
 * - `bun:sqlite`'s `Database`: every statement runs on the run's SQLite,
 *   opened for the request (`enter`); outside a request (the mock's own
 *   setup) on a scratch database of its own, which the run never sees. SQL
 *   runs as Bun runs it: values bind as Bun binds them, `CURRENT_TIMESTAMP`
 *   and each time function's `'now'` are the request's time, and a PRAGMA
 *   that would change the file's journal is left out. A `foreign_keys`
 *   PRAGMA the mock sets holds for its later requests, as on its one
 *   connection upstream.
 * - `node:fs`: a file the mock writes is a row of the run's `_file` table;
 *   a read finds that row, else the file it names in upstream's checkout
 *   (`map`). Outside a request the files are a scratch copy of the run's
 *   when its copy of the mock was made. Nothing on the host is written.
 * - `Bun.file`, and `hono/bun`'s static files, read the same way.
 * - `Date` and `process.env`: the request's time and the run's environment.
 */
import * as fs from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type DatabaseSyncOptions, type SQLInputValue, type StatementSync } from 'node:sqlite'

interface Current {
  connection: DatabaseSync
  nowMs: number
}

const self = {
  env: {} as Record<string, string | undefined>,
  /** Path prefixes of upstream's image, and the host directory each reads from. */
  map: {} as Record<string, string>,
  /** The time outside a request: the run's when its copy was made. */
  startMs: 0,
  current: undefined as Current | undefined,
  /** The files written outside a request. */
  scratchFiles: new Map<string, Buffer>(),
  /** The paths a request wrote or removed. */
  touched: new Set<string>(),
  /** PRAGMAs the mock set that a connection keeps, by name. */
  pragmas: new Map<string, string>(),
}

/** The control the fake has over this copy of the mock. */
export const vfsbench = {
  configure(options: {
    env: Record<string, string>
    map: Record<string, string>
    startMs: number
    files: Record<string, Buffer>
  }): void {
    self.env = { ...options.env }
    self.map = options.map
    self.startMs = options.startMs
    self.scratchFiles = new Map(Object.entries(options.files))
  },
  /** Answer the requests until `leave` on this connection, at this time. */
  enter(connection: DatabaseSync, nowMs: number): void {
    for (const [name, value] of self.pragmas) connection.exec(`PRAGMA ${name} = ${value}`)
    self.current = { connection, nowMs }
    self.touched = new Set()
  },
  /** The paths the request wrote or removed. */
  leave(): string[] {
    self.current = undefined
    return [...self.touched]
  },
}

const nowMs = () => self.current?.nowMs ?? self.startMs

// --- Date and process.env ---

const RealDate = globalThis.Date

class FrozenDate extends RealDate {
  // Any of Date's forms; the arguments go to it as they came.
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs())
    else super(...(args as [number, number]))
  }

  static override now(): number {
    return nowMs()
  }
}

export { FrozenDate as Date }

/** `process.env`, the run's. */
export const __vfsbenchEnv = new Proxy({} as Record<string, string | undefined>, {
  get: (_t, name) => (typeof name === 'string' ? self.env[name] : undefined),
  set: (_t, name, value) => {
    if (typeof name === 'string') self.env[name] = value === undefined ? undefined : String(value)
    return true
  },
  has: (_t, name) => typeof name === 'string' && self.env[name] !== undefined,
  deleteProperty: (_t, name) => {
    if (typeof name === 'string') delete self.env[name]
    return true
  },
  ownKeys: () => Object.keys(self.env).filter((k) => self.env[k] !== undefined),
  getOwnPropertyDescriptor: (_t, name) =>
    typeof name === 'string' && self.env[name] !== undefined
      ? { value: self.env[name], enumerable: true, configurable: true, writable: true }
      : undefined,
})

// --- SQLite ---

/** SQLite's `datetime('now')` form of a time. */
function sqliteTime(ms: number): string {
  return new RealDate(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** A connection with SQLite's own time functions, for their forms other than 'now'. */
let builtIn: DatabaseSync | undefined

const TIME_FUNCTIONS = ['datetime', 'date', 'time', 'julianday', 'strftime', 'unixepoch']

/** A connection whose time functions read 'now' as `now()`. */
function timed(connection: DatabaseSync, now: () => number): DatabaseSync {
  for (const name of TIME_FUNCTIONS) {
    connection.function(name, { varargs: true, deterministic: false }, (...args) => {
      const at = sqliteTime(now())
      const given = args.length === 0 && name !== 'strftime' ? [at] : args.map((a) => (a === 'now' ? at : a))
      builtIn ??= new DatabaseSync(':memory:')
      const marks = given.map(() => '?').join(', ')
      return (builtIn.prepare(`SELECT ${name}(${marks}) AS v`).get(...(given as SQLInputValue[])) as { v: SQLInputValue }).v
    })
  }
  return connection
}

/** The run's file, opened for a request: its time functions read 'now' as `now()`. */
export function openRun(file: string, now: () => number, options?: DatabaseSyncOptions): DatabaseSync {
  // Node 24.15 and later refuse an undefined options argument.
  return timed(options === undefined ? new DatabaseSync(file) : new DatabaseSync(file, options), now)
}

/**
 * A statement's SQL as it runs here: `CURRENT_TIMESTAMP` and its kin are
 * the time functions' 'now', and a PRAGMA that changes the journal or its
 * syncing is left out, so a run's file stays in the rollback journal.
 */
function rewrite(sql: string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\bCURRENT_TIMESTAMP\b/gi, "(datetime('now'))")
            .replace(/\bCURRENT_DATE\b/gi, "(date('now'))")
            .replace(/\bCURRENT_TIME\b/gi, "(time('now'))")
            .replace(/\bPRAGMA\s+(journal_mode|synchronous|wal_checkpoint|busy_timeout)\b[^;']*;?/gi, ''),
    )
    .join('')
}

/** Note a PRAGMA a connection keeps, to set it on the next request's too. */
function notePragmas(sql: string): void {
  for (const m of sql.matchAll(/\bPRAGMA\s+(foreign_keys)\s*=\s*(\w+)/gi)) self.pragmas.set(m[1]!.toLowerCase(), m[2]!)
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

/**
 * bun:sqlite's reading of a statement's arguments: a first argument that
 * is an array is the list, one that is an object the named bindings.
 */
function bindings(sql: string, args: unknown[]): SQLInputValue[] | [Record<string, SQLInputValue>] {
  const first = args[0]
  if (Array.isArray(first)) return first.map(bindable)
  if (typeof first === 'object' && first !== null && !ArrayBuffer.isView(first)) {
    if (!/[$:@][A-Za-z_]/.test(sql)) return Array.from(sql.matchAll(/\?/g), () => null)
    return [Object.fromEntries(Object.entries(first).map(([k, v]) => [k, bindable(v)]))]
  }
  return args.map(bindable)
}

/** A row as bun:sqlite hands it: a plain object, or null for none. */
const plain = (row: unknown) => (row === undefined ? null : { ...(row as object) })

/** bun:sqlite's `Statement`, prepared on whichever connection runs it. */
export class Statement {
  readonly #db: Database
  readonly #sql: string
  readonly #prepared = new WeakMap<DatabaseSync, StatementSync>()

  constructor(db: Database, sql: string) {
    this.#db = db
    this.#sql = rewrite(sql)
    notePragmas(sql)
  }

  #statement(): StatementSync {
    const connection = this.#db.connection()
    let prepared = this.#prepared.get(connection)
    if (prepared === undefined) {
      prepared = connection.prepare(this.#sql)
      this.#prepared.set(connection, prepared)
    }
    return prepared
  }

  get(...args: unknown[]) {
    return plain(this.#statement().get(...(bindings(this.#sql, args) as SQLInputValue[])))
  }

  all(...args: unknown[]) {
    return this.#statement()
      .all(...(bindings(this.#sql, args) as SQLInputValue[]))
      .map(plain)
  }

  values(...args: unknown[]) {
    return this.all(...args).map((row) => Object.values(row as object))
  }

  *iterate(...args: unknown[]) {
    yield* this.all(...args)
  }

  run(...args: unknown[]) {
    const done = this.#statement().run(...(bindings(this.#sql, args) as SQLInputValue[]))
    return { lastInsertRowid: done.lastInsertRowid, changes: done.changes }
  }

  finalize(): void {}

  toString(): string {
    return this.#sql
  }
}

/** bun:sqlite's `Database`: the request's run, or a scratch of its own outside one. */
export class Database {
  readonly filename: string
  #scratch: DatabaseSync | undefined
  #depth = 0

  constructor(filename = ':memory:', _options?: unknown) {
    this.filename = filename
  }

  connection(): DatabaseSync {
    if (self.current !== undefined) return self.current.connection
    this.#scratch ??= timed(new DatabaseSync(':memory:'), nowMs)
    return this.#scratch
  }

  query(sql: string): Statement {
    return new Statement(this, sql)
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql)
  }

  /** bun:sqlite's `run` (and `exec`, the same): several statements, or one with its arguments. */
  run(sql: string, ...args: unknown[]) {
    if (args.length > 0) return this.query(sql).run(...args)
    notePragmas(sql)
    const text = rewrite(sql)
    if (text.trim() !== '') this.connection().exec(text)
    const changes = this.connection().prepare('SELECT changes() AS c, last_insert_rowid() AS r').get() as { c: number; r: number }
    return { lastInsertRowid: changes.r, changes: changes.c }
  }

  exec(sql: string, ...args: unknown[]) {
    return this.run(sql, ...args)
  }

  /** bun:sqlite's `transaction(fn)`: a function that runs `fn` in one, nested as savepoints. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const wrapped = (...args: A): R => {
      const depth = this.#depth++
      this.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT vfsbench_${depth}`)
      try {
        const out = fn(...args)
        this.exec(depth === 0 ? 'COMMIT' : `RELEASE vfsbench_${depth}`)
        return out
      } catch (error) {
        this.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO vfsbench_${depth}`)
        throw error
      } finally {
        this.#depth--
      }
    }
    return Object.assign(wrapped, { deferred: wrapped, immediate: wrapped, exclusive: wrapped })
  }

  close(): void {}
}

// --- files ---

/** The run's `_file` table (each fake's schema has it), created on first use. */
function fileTable(connection: DatabaseSync): DatabaseSync {
  connection.exec(
    'CREATE TABLE IF NOT EXISTS "_file" ("path" TEXT NOT NULL PRIMARY KEY, "data" TEXT NOT NULL, "encoding" TEXT NOT NULL DEFAULT \'utf8\')',
  )
  return connection
}

/** A file's bytes as a `_file` row keeps them: text as it is, anything else as base64. */
export function fileRow(data: Buffer): { data: string; encoding: string } {
  const utf8 = data.toString('utf8')
  return Buffer.from(utf8, 'utf8').equals(data) ? { data: utf8, encoding: 'utf8' } : { data: data.toString('base64'), encoding: 'base64' }
}

export function fileBytes(row: { data: string; encoding: string }): Buffer {
  return Buffer.from(row.data, row.encoding === 'base64' ? 'base64' : 'utf8')
}

function readRun(path: string): Buffer | undefined {
  if (self.current === undefined) return self.scratchFiles.get(path)
  const row = fileTable(self.current.connection).prepare('SELECT data, encoding FROM "_file" WHERE path = ?').get(path) as
    | { data: string; encoding: string }
    | undefined
  return row === undefined ? undefined : fileBytes(row)
}

function writeRun(path: string, data: Buffer | undefined): void {
  if (self.current === undefined) {
    if (data === undefined) self.scratchFiles.delete(path)
    else self.scratchFiles.set(path, data)
    return
  }
  const connection = fileTable(self.current.connection)
  if (data === undefined) connection.prepare('DELETE FROM "_file" WHERE path = ?').run(path)
  else {
    const row = fileRow(data)
    connection.prepare('INSERT OR REPLACE INTO "_file" (path, data, encoding) VALUES (?, ?, ?)').run(path, row.data, row.encoding)
  }
  self.touched.add(path)
}

/** The host file an image path reads, through `map`, if any. */
function hostFile(path: string): string | undefined {
  for (const [prefix, dir] of Object.entries(self.map)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return join(dir, path.slice(prefix.length))
  }
  return undefined
}

function enoent(syscall: string, path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${path}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall,
    path,
  })
}

const pathOf = (path: unknown) => String(path)

/** A file's bytes: the run's, or upstream's checkout's, or undefined. */
export function readBytes(path: string): Buffer | undefined {
  const own = readRun(path)
  if (own !== undefined) return own
  const host = hostFile(path)
  if (host !== undefined && fs.existsSync(host) && fs.statSync(host).isFile()) return fs.readFileSync(host)
  return undefined
}

const text = (data: unknown, encoding?: unknown) =>
  typeof data === 'string' ? Buffer.from(data, (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding) : Buffer.from(data as Uint8Array)

const encodingOf = (options: unknown) =>
  typeof options === 'string' ? options : (options as { encoding?: string } | undefined)?.encoding

export function readFileSync(path: unknown, options?: unknown) {
  const data = readBytes(pathOf(path))
  if (data === undefined) throw enoent('open', pathOf(path))
  const encoding = encodingOf(options)
  return encoding === undefined ? data : data.toString(encoding as BufferEncoding)
}

export function writeFileSync(path: unknown, data: unknown, options?: unknown): void {
  writeRun(pathOf(path), text(data, encodingOf(options)))
}

export function appendFileSync(path: unknown, data: unknown, options?: unknown): void {
  writeRun(pathOf(path), Buffer.concat([readRun(pathOf(path)) ?? Buffer.alloc(0), text(data, encodingOf(options))]))
}

export function existsSync(path: unknown): boolean {
  const p = pathOf(path)
  if (readRun(p) !== undefined) return true
  const host = hostFile(p)
  return host !== undefined && fs.existsSync(host)
}

export function unlinkSync(path: unknown): void {
  const p = pathOf(path)
  if (readRun(p) === undefined) throw enoent('unlink', p)
  writeRun(p, undefined)
}

export function copyFileSync(from: unknown, to: unknown): void {
  writeRun(pathOf(to), readFileSync(from) as Buffer)
}

/** Directories are implied by the files in them. */
export function mkdirSync(): undefined {
  return undefined
}

export function rmSync(path: unknown): void {
  const p = pathOf(path)
  if (readRun(p) !== undefined) writeRun(p, undefined)
}

export default { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, copyFileSync, mkdirSync, rmSync }

/** `Bun`, as far as the mocks use it: `Bun.file`, and `Bun.write` (the airline's seed note). */
export const Bun = {
  /** A file written, as `writeFileSync` writes it; its byte count, as Bun's promise gives it. */
  write(path: unknown, data: unknown): Promise<number> {
    try {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array))
      writeRun(pathOf(path), bytes)
      return Promise.resolve(bytes.length)
    } catch (error) {
      return Promise.reject(error as Error)
    }
  },
  file(path: string) {
    const bytes = () => {
      const data = readBytes(path)
      if (data === undefined) throw enoent('open', path)
      return data
    }
    return {
      exists: async () => readBytes(path) !== undefined,
      text: async () => bytes().toString('utf8'),
      json: async () => JSON.parse(bytes().toString('utf8')) as unknown,
      arrayBuffer: async () => new Uint8Array(bytes()).buffer,
      delete: async () => unlinkSync(path),
    }
  },
}

/** A static file's bytes, for `hono/bun`'s `serveStatic`, or null. */
export async function staticContent(path: string): Promise<Uint8Array | null> {
  const data = readBytes(path)
  return data === undefined ? null : new Uint8Array(data)
}
