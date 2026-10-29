/**
 * A kit fake that is an upstream LiveClawBench mock: upstream's own app,
 * its handlers, pages and mock-lib, answering each request on the run it
 * was sent to (bundle.ts, instance.ts).
 *
 * Each run gets a copy of the mock of its own the first time it is asked,
 * made by the mock's own factory and seed, as upstream's `startServer`
 * starts it, with the run's environment (the image's for the mock, and the
 * fixture's `_env`, `TASK_NAME` among it), and forgotten when the run is
 * reset, as a restarted mock would be. The factory and seed run on a
 * scratch database and a scratch copy of the run's files, for what the
 * mock keeps in memory (the shop's products); the run's world is its
 * fixture's rows, seeded by the kit. Every request is a write to the kit,
 * so a run's requests take turns, as on a single-threaded mock, and one
 * that changes a row or a file moves the run's clock a tick.
 *
 * A file the mock writes is a row of the run's `_file` table. Each one is
 * also kept as a file beside the run's SQLite, `<run>.db.files/<path,
 * escaped>`, which the environment hands the verifier where the task's
 * mirage.yaml names it (`files`), as upstream's image keeps it on disk.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { TICK_MS, route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, KitConfig, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { ClientCtor, MinimalClient } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { type Copy, bundle, load } from './bundle.ts'
import { checkTriggers } from './checks.ts'
import { fileBytes, openRun } from './instance.ts'
import { MOCKS } from './mocks.ts'

/** Upstream's mock platform, in the checkout `liveclawbench/setup.py` downloads. */
export const PLATFORM =
  process.env.LIVECLAWBENCH_PLATFORM ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform')

/** A run's client that knows its file, and runs SQL. */
export interface UpstreamClient extends MinimalClient {
  readonly file: string
  $executeRawUnsafe(sql: string): Promise<number>
}

export interface UpstreamSpec {
  /** The mock's entry module, in upstream's checkout. */
  entry: string
  /** Its app factory, as upstream's serve.ts calls it. */
  factory: string
  /** The port the mock listens on in upstream's image, which its URLs name. */
  port: number
  /** The environment upstream's image starts the mock with. */
  env: Record<string, string>
  /** Path prefixes of upstream's image, each read from a host directory. */
  map: Record<string, string>
}

/** A service's spec, from mocks.ts: its entry in upstream's checkout, and the image's static files read from there. */
export function serviceSpec(service: string): UpstreamSpec {
  const mock = MOCKS[service]
  if (mock === undefined) throw new Error(`no upstream mock spec for ${service}`)
  return {
    entry: join(PLATFORM, 'mocks', mock.mock ?? service, mock.entry),
    factory: mock.factory,
    port: mock.port,
    env: mock.env,
    map: { '/opt/mock/static': join(PLATFORM, 'static') },
  }
}

/** Headers of the connection, not the request. */
const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'])

/** A header's name as the kit writes it (`Content-Type`). */
const headerName = (name: string) => name.replace(/(^|-)([a-z])/g, (_m, dash: string, c: string) => dash + c.toUpperCase())

/** The directory beside a run's SQLite where its files are kept as files. */
export const filesDir = (file: string) => `${file}.files`

function requestOf(method: string, port: number, ctx: Ctx<UpstreamClient>): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(ctx.headers)) {
    if (value === undefined || HOP.has(name.toLowerCase())) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(`http://localhost:${port}${ctx.url.pathname}${ctx.url.search}`, {
    method,
    headers,
    ...(hasBody ? { body: new Uint8Array(ctx.body) } : {}),
  })
}

async function replyOf(response: Response): Promise<Reply> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[headerName(name)] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  const body = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers, ...(body.length > 0 ? { body } : {}) }
}

/** Keep each of the run's files named, as written or removed, beside its SQLite. */
function mirror(connection: DatabaseSync, file: string, paths: string[] | 'all'): void {
  const dir = filesDir(file)
  mkdirSync(dir, { recursive: true })
  const exists = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_file'").get()
  if (exists === undefined) return
  const rows = (
    paths === 'all'
      ? connection.prepare('SELECT path, data, encoding FROM "_file"').all()
      : paths.map((path) => connection.prepare('SELECT path, data, encoding FROM "_file" WHERE path = ?').get(path) ?? { path })
  ) as { path: string; data?: string; encoding?: string }[]
  for (const row of rows) {
    const target = join(dir, encodeURIComponent(row.path))
    if (row.data === undefined) rmSync(target, { force: true })
    else writeFileSync(target, fileBytes(row as { data: string; encoding: string }))
  }
}

/**
 * Once the kit has seeded a run: the rows of upstream's tables Prisma cannot
 * key, upstream's own triggers and views, its CHECKs as triggers, and its
 * files beside the run.
 */
function afterSeed(file: string): void {
  rmSync(filesDir(file), { recursive: true, force: true })
  const connection = openRun(file, () => Date.now())
  try {
    // The rows of tables Prisma cannot key, in the fixture's order.
    const unkeyed = connection.prepare('SELECT "table", data FROM "_row" ORDER BY seq').all() as { table: string; data: string }[]
    for (const { table, data } of unkeyed) {
      const row = JSON.parse(data) as Record<string, SQLInputValue>
      const names = Object.keys(row)
      connection
        .prepare(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
        .run(...names.map((n) => row[n]!))
    }
    connection.exec('DELETE FROM "_row"')
    const schema = connection.prepare('SELECT type, name, sql FROM "_schema"').all() as { type: string; name: string; sql: string }[]
    for (const { type, name, sql } of schema) {
      if (type === 'trigger' || type === 'view') connection.exec(sql)
      if (type !== 'table') continue
      const columns = (connection.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name)
      for (const trigger of checkTriggers(name, sql, columns)) connection.exec(trigger)
    }
    mirror(connection, file, 'all')
  } finally {
    connection.close()
  }
}

/** A kit fake that runs an upstream mock. */
export function upstreamFake<C extends UpstreamClient>(spec: UpstreamSpec, config: KitConfig, client: ClientCtor<C>, dmmf: Dmmf): Fake<C> {
  let bundled: Promise<string> | undefined
  const copies = new WeakMap<C, Promise<{ copy: Copy; app: ReturnType<Copy['create']> }>>()

  /** The run's copy of the mock, made on its first request. */
  function copyOf(ctx: Ctx<C>) {
    let made = copies.get(ctx.db)
    if (made === undefined) {
      made = (async () => {
        bundled ??= bundle(spec.entry, spec.factory)
        const copy = await load(await bundled)
        const startMs = Date.parse(ctx.clock.lastIso())
        const connection = openRun(ctx.db.file, () => startMs)
        try {
          const env = connection.prepare('SELECT name, value FROM "_env"').all() as { name: string; value: string }[]
          const files = connection.prepare('SELECT path, data, encoding FROM "_file"').all() as { path: string; data: string; encoding: string }[]
          copy.vfsbench.configure({
            env: { ...spec.env, ...Object.fromEntries(env.map((e) => [e.name, e.value])) },
            map: spec.map,
            startMs,
            files: Object.fromEntries(files.map((f) => [f.path, fileBytes(f)])),
          })
          // As upstream's startServer: the factory, then its seed, on the
          // copy's scratch database and files; the run holds what they write.
          const app = copy.create()
          await app.seed?.()
          return { copy, app }
        } finally {
          connection.close()
        }
      })()
      copies.set(ctx.db, made)
    }
    return made
  }

  async function answer(method: string, ctx: Ctx<C>): Promise<Reply> {
    const { copy, app } = await copyOf(ctx)
    const nowMs = Date.parse(ctx.clock.lastIso()) + TICK_MS
    const connection = openRun(ctx.db.file, () => nowMs)
    let touched: string[] = []
    try {
      copy.vfsbench.enter(connection, nowMs)
      let reply: Reply
      try {
        reply = await replyOf(await app.app.fetch(requestOf(method, spec.port, ctx)))
      } finally {
        touched = copy.vfsbench.leave()
      }
      if (touched.length > 0) mirror(connection, ctx.db.file, touched)
      const changed = (connection.prepare('SELECT total_changes() AS n').get() as { n: number }).n > 0
      if (changed) ctx.clock.nowMs()
      return reply
    } finally {
      connection.close()
    }
  }

  return {
    config,
    client,
    dmmf,
    // A fixture names each table as upstream does.
    seedRoots: Object.fromEntries(dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m.name])),
    afterSeed: async (db) => afterSeed(db.file),
    afterReset: (db) => {
      copies.delete(db)
    },
    routes: (): KitRoute<C>[] =>
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) =>
        route<C>(method, '/*rest', (ctx) => answer(method, ctx), { write: true }),
      ),
  }
}
