/**
 * The fixture of a fake that runs an upstream mock (mocks/upstream): the
 * mock seeded as upstream's image starts it, as its rows and files.
 *
 * The mock runs as it is, under Bun: its factory, then its `seed()`, as
 * upstream's `startServer` calls them, with `TASK_NAME` the task's and the
 * image's environment for it (mocks/upstream/mocks.ts), each path in it
 * under a scratch root that stands for the image's `/`. The task's own
 * assets (task-binary-map.json's `assets` from the task, and its
 * Dockerfile's `COPY`s into `/opt/mock/`) are put at their paths there
 * first. A task with a legacy startup script then gets the rows and files
 * the script adds to the mock (`startup.ts`).
 *
 * The clock is frozen at the epoch: `Date` (main.ts), and SQLite's 'now'
 * and `CURRENT_TIMESTAMP`, in every statement the mock prepares. Random
 * numbers are a counter's, so a seed that salts a password hash writes the
 * same fixture each time.
 *
 * The fixture is every table of the mock's SQLite, parents first, its
 * CREATE TABLE, INDEX, TRIGGER and VIEW statements (`_schema`; each run
 * gets its triggers and views, and the tables' CHECKs as triggers), the run's `TASK_NAME` (`_env`), and every file the seed wrote
 * and every task asset, by its path in the image (`_file`). A table Prisma
 * cannot key (no primary key that is never NULL, nor such a unique index)
 * has its rows in `_row` instead, which the fake inserts itself. A mock
 * whose seed runs in the fake (`seedsRun`) has no rows here, only each
 * table's digest (`_seed`), which the fake's seed must match.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { digest, seedRow } from '../mocks/upstream/digest.ts'
import { MOCKS } from '../mocks/upstream/mocks.ts'
import { startupFiles, startupSql } from './startup.ts'

const SQLITE = /\.(db|sqlite)(-wal|-shm|-journal)?$/

/** SQL with `edit` applied outside its string literals. */
function outsideStrings(sql: string, edit: (code: string) => string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 1 ? part : edit(part)))
    .join('')
}

/** Every database the mock has used, for one it keeps in memory. */
const opened = new Set<Database>()

/** SQLite's 'now', CURRENT_TIMESTAMP and kin, at the epoch, in each statement. */
function freezeSqlite(epoch: string): void {
  const at = new Date(epoch).toISOString()
  const stamp = at.slice(0, 19).replace('T', ' ')
  const freeze = (sql: unknown) =>
    typeof sql === 'string'
      ? outsideStrings(sql.replace(/'now'/gi, `'${stamp}'`), (code) =>
          code
            .replace(/\bCURRENT_TIMESTAMP\b/gi, `'${stamp}'`)
            .replace(/\bCURRENT_DATE\b/gi, `'${stamp.slice(0, 10)}'`)
            .replace(/\bCURRENT_TIME\b/gi, `'${stamp.slice(11)}'`),
        )
      : sql
  const proto = Database.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
  for (const name of ['run', 'exec', 'query', 'prepare']) {
    const original = proto[name]!
    proto[name] = function (this: Database, sql: unknown, ...rest: unknown[]) {
      opened.add(this)
      return original.call(this, freeze(sql), ...rest)
    }
  }
}

/** Random numbers, a counter's. */
let counted = 0

function countRandom(name = 'upstream-seed'): void {
  const next = () => createHash('sha256').update(`${name}-${++counted}`).digest()
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    value: <T extends ArrayBufferView>(array: T): T => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (let i = 0; i < bytes.length; i += 32) bytes.set(next().subarray(0, Math.min(32, bytes.length - i)), i)
      return array
    },
  })
  Math.random = () => next().readUInt32BE(0) / 2 ** 32
  // A dependency that draws from Node's crypto (bcryptjs's salts) too.
  const crypto = createRequire(import.meta.url)('node:crypto') as { randomBytes: (size: number) => Buffer }
  crypto.randomBytes = (size: number) => {
    const bytes = Buffer.alloc(size)
    for (let i = 0; i < size; i += 32) next().copy(bytes, i, 0, Math.min(32, size - i))
    return bytes
  }
}

/** The assets the task's image has for its mocks, by their path in the image. */
function assets(platform: string, task: string): Record<string, string> {
  const map = JSON.parse(readFileSync(join(platform, 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, { assets?: { src: string; dest: string }[] }>
  }
  const out: Record<string, string> = {}
  for (const asset of map.tasks[task]?.assets ?? []) {
    // One the fakes read from the checkout at its own path (a stylesheet) is not the task's.
    if (asset.src !== `mock-platform${asset.dest.replace(/^\/opt\/mock/, '')}`) out[asset.dest] = join(platform, '..', asset.src)
  }
  const taskDir = join(platform, '..', 'tasks', task)
  const dockerfile = readFileSync(join(taskDir, 'environment', 'Dockerfile'), 'utf8')
  for (const m of dockerfile.matchAll(/^COPY\s+(\S+)\s+(\/opt\/mock\/\S+)\s*$/gm)) {
    const from = join(taskDir, 'environment', m[1]!)
    if (existsSync(from) && statSync(from).isFile()) out[m[2]!] = from
  }
  return out
}

/** Every file under a directory, by its path relative to it. */
function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)]
  })
}

/** Tables, parents first: each after the tables its foreign keys name. */
function parentsFirst(db: Database, tables: string[]): string[] {
  const out: string[] = []
  const visit = (table: string, seen: Set<string>) => {
    if (out.includes(table) || seen.has(table)) return
    seen.add(table)
    const parents = db.query(`PRAGMA foreign_key_list("${table}")`).all() as { table: string }[]
    for (const p of parents) if (p.table !== table && tables.includes(p.table)) visit(p.table, seen)
    out.push(table)
  }
  for (const table of tables) visit(table, new Set())
  return out
}

/**
 * Whether Prisma can key a table, and so seed it: by a primary key whose
 * columns are never NULL (or the rowid), or a unique index on such columns.
 */
function keyed(db: Database, table: string): boolean {
  const columns = db.query(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; notnull: number; pk: number }[]
  const pk = columns.filter((c) => c.pk > 0)
  const rowid = pk.length === 1 && pk[0]!.type.toUpperCase() === 'INTEGER'
  if (pk.length > 0 && (rowid || pk.every((c) => c.notnull === 1))) return true
  const notNull = new Set(columns.filter((c) => c.notnull === 1).map((c) => c.name))
  const indexes = db.query(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number }[]
  return indexes.some(
    (i) => i.unique === 1 && (db.query(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).every((c) => notNull.has(c.name)),
  )
}

/** A row for the fixture: a blob is refused, as no fake here keeps one. */
function jsonRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array) throw new Error(`${table}.${k} is a blob, which a fixture does not carry`)
  }
  return row
}

/** Upstream's mock for a task, seeded as its image starts it, under a scratch root that stands for the image's `/`. */
export interface Booted {
  app: { fetch: (request: Request) => Response | Promise<Response> }
  /** A path in the image, under the scratch root. */
  at: (path: string) => string
  scratch: string
  root: string
  /** The task's own assets, by their path in the image. */
  own: Record<string, string>
  /** The random numbers the mock's modules drew as they loaded, before its factory ran. */
  importDraws: number
}

/** Boot upstream's mock for a task: its factory, then its `seed()`, at the frozen epoch. */
export async function boot(platform: string, service: string, task: string, epoch: string): Promise<Booted> {
  const spec = MOCKS[service]
  if (spec === undefined) throw new Error(`no upstream mock spec for ${service}`)
  const mock = spec.mock ?? service
  process.env.TASK_NAME = task
  process.env.FROZEN_EPOCH = epoch
  await import('./frozen.ts')
  freezeSqlite(epoch)
  countRandom(spec.random)
  const scratch = mkdtempSync(join(tmpdir(), `vfsbench-${mock}-seed-`))
  const root = join(scratch, 'root')
  const at = (path: string) => join(root, path)
  const own = assets(platform, task)
  for (const [dest, from] of Object.entries(own)) {
    mkdirSync(dirname(at(dest)), { recursive: true })
    copyFileSync(from, at(dest))
  }
  for (const [name, value] of Object.entries(spec.env)) process.env[name] = value.startsWith('/') ? at(value) : value
  process.env.HOME = at('/home/node')
  process.env.MOCK_EXTRA_SEED_DIR = at('/opt/mock/extra-seed')
  if (spec.db !== undefined) mkdirSync(dirname(at(spec.db)), { recursive: true })

  // The mock logs to stdout, which is the fixture's.
  const log = console.log
  console.log = (...args: unknown[]) => console.error(...args)
  try {
    const module = (await import(join(platform, 'mocks', mock, spec.entry))) as Record<string, () => Booted['app'] & { app?: Booted['app']; seed?: () => unknown }>
    const importDraws = counted
    const made = module[spec.factory]!()
    await made.seed?.()
    return { app: made.app ?? made, at, scratch, root, own, importDraws }
  } finally {
    console.log = log
  }
}

/** The task's legacy startup script's rows and files, which its image adds after the seed (`startup.ts`). */
export async function startup(platform: string, service: string, task: string, booted: Booted): Promise<void> {
  const spec = MOCKS[service]!
  const mock = spec.mock ?? service
  if (spec.db !== undefined && spec.db !== ':memory:') {
    const db = new Database(booted.at(spec.db))
    for (const sql of startupSql(platform, task, mock)) db.run(sql)
    db.close()
  }
  for (const [path, text] of Object.entries(startupFiles(platform, task, mock))) {
    mkdirSync(dirname(booted.at(path)), { recursive: true })
    await Bun.write(booted.at(path), text)
  }
}

export async function upstream(platform: string, service: string, task: string, epoch: string): Promise<Record<string, unknown[]>> {
  const spec = MOCKS[service]
  if (spec === undefined) throw new Error(`no upstream mock spec for ${service}`)
  const mock = spec.mock ?? service
  const { at, scratch, root, own, importDraws } = await boot(platform, service, task, epoch)

  const out: Record<string, unknown[]> = { _env: [{ name: 'TASK_NAME', value: task }] }
  if (spec.db === ':memory:') {
    // A mock that keeps its database in memory (workspace): the one it filled, as a file.
    const memory = [...opened].filter((d) => d.filename === ':memory:' && d.query("SELECT 1 FROM sqlite_master WHERE type = 'table'").get() !== null)
    if (memory.length !== 1) throw new Error(`${mock}: ${memory.length} in-memory databases with tables, not one`)
    await Bun.write(at('/memory.db'), memory[0]!.serialize())
  }
  if (spec.db !== undefined) {
    const db = new Database(at(spec.db === ':memory:' ? '/memory.db' : spec.db))
    for (const sql of startupSql(platform, task, mock)) db.run(sql)
    const schema = db
      .query(
        "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all() as { type: string; name: string; sql: string }[]
    // A trigger or view runs as the run's connection compiles it, so its
    // frozen 'now' is SQLite's 'now' again, which each run answers with its clock.
    const stamp = `'${new Date(epoch).toISOString().slice(0, 19).replace('T', ' ')}'`
    out._schema = schema.map((s) =>
      s.type === 'trigger' || s.type === 'view' ? { ...s, sql: s.sql.split(stamp).join("datetime('now')") } : s,
    )
    if (spec.seedsRun === true) {
      // The rows are too many to commit: the fake runs the seed on each
      // run's template and checks it against this digest (mocks.ts).
      if (startupSql(platform, task, mock).length > 0) throw new Error(`${task}: a startup script's rows on ${mock}, whose seed runs in the fake`)
      const tables = schema.filter((s) => s.type === 'table').map((s) => s.name)
      // The fake's copy has loaded before it counts: it starts the count past the draws loading made here.
      out._seed = [
        { name: 'draws:import', value: String(importDraws) },
        ...Object.entries(digest(tables, (sql) => db.query(sql).all())).map(([table, value]) => ({ name: seedRow(table), value })),
      ]
    }
    const unkeyed: unknown[] = []
    for (const table of spec.seedsRun === true ? [] : parentsFirst(
      db,
      schema.filter((s) => s.type === 'table').map((s) => s.name),
    )) {
      const rows = (db.query(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Record<string, unknown>[]).map((r) => jsonRow(table, r))
      // A table Prisma cannot key is seeded by the fake itself, in order (`_row`).
      if (keyed(db, table)) out[table] = rows
      else for (const row of rows) unkeyed.push({ seq: unkeyed.length + 1, table, data: JSON.stringify(row) })
      // The kit seeds each row with its own id, which leaves the table's
      // AUTOINCREMENT counter at the largest; upstream's must be there too.
      const sequences = db.query("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get() !== null
      const seq = sequences ? (db.query('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | null) : null
      const max = db.query(`SELECT MAX(rowid) AS max FROM "${table}"`).get() as { max: number | null }
      if (seq !== null && seq.seq !== max.max) {
        throw new Error(`${table}: upstream's next id follows ${seq.seq}, not its largest, ${max.max ?? 'none'}`)
      }
    }
    if (unkeyed.length > 0) out._row = unkeyed
    db.close()
  }
  // What the task's startup script writes into the mock's data directory, after the seed.
  for (const [path, text] of Object.entries(startupFiles(platform, task, mock))) {
    mkdirSync(dirname(at(path)), { recursive: true })
    await Bun.write(at(path), text)
  }
  const files: { path: string; data: string; encoding: string }[] = []
  const written = walk(root)
    .map((path) => `/${path}`)
    .filter((path) => !SQLITE.test(path) && !(path in own))
  for (const path of [...Object.keys(own), ...written].sort()) {
    const data = readFileSync(at(path))
    const utf8 = data.toString('utf8')
    files.push(
      Buffer.from(utf8, 'utf8').equals(data)
        ? { path, data: utf8, encoding: 'utf8' }
        : { path, data: data.toString('base64'), encoding: 'base64' },
    )
  }
  out._file = files
  rmSync(scratch, { recursive: true, force: true })
  return out
}
