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
 *
 * A mock whose seed is too big to commit (`seedsRun` in mocks.ts: the
 * airline) has a fixture of no rows, only a digest of each table as the
 * seed leaves it under Bun (`_seed`). Each reset, once the kit has seeded
 * the run, the fake runs the mock's factory and seed on it, as upstream's
 * mock seeds itself when it starts, with the clock at the epoch
 * and random numbers a counter's, as `harbor/fixtures/upstream.ts` has
 * them; a table that then differs from its digest fails the reset. Each
 * run's copy of such a mock is made on the run's database, so its seed
 * finds the rows there and skips, as upstream's does on a restart.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { TICK_MS, route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, KitConfig, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { ClientCtor, MinimalClient } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { type Copy, bundle, load } from './bundle.ts'
import { checkTriggers } from './checks.ts'
import { digest, seedRow } from './digest.ts'
import { fileBytes, openRun } from './instance.ts'
import { MOCKS } from './mocks.ts'

/** Upstream's mock platform, in the checkout `liveclawbench/setup.py` downloads. */
export const PLATFORM =
  process.env.LIVECLAWBENCH_PLATFORM ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform')

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
  /** The name a run's seed counts its random numbers under (mocks.ts). */
  random?: string
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
    ...(mock.random === undefined ? {} : { random: mock.random }),
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

/** Whether a run's world is the seed's own (`_seed`), not the fixture's rows. */
function seedsRun(connection: DatabaseSync): boolean {
  const exists = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_seed'").get()
  return exists !== undefined && connection.prepare('SELECT 1 FROM "_seed" LIMIT 1').get() !== undefined
}

/**
 * Random numbers a counter's, as `harbor/fixtures/upstream.ts` counts them
 * for the fixture (`Math.random`, `crypto.getRandomValues` and Node's
 * `randomBytes`, one counter), from the draws upstream's modules made as
 * they loaded there; the function returned puts them back.
 */
function countRandom(from: number, name = 'upstream-seed'): () => void {
  let counted = from
  const next = () => createHash('sha256').update(`${name}-${++counted}`).digest()
  const random = Math.random
  const nodeCrypto = createRequire(import.meta.url)('node:crypto') as { randomBytes: (size: number) => Buffer }
  const randomBytes = nodeCrypto.randomBytes
  const own = Object.getOwnPropertyDescriptor(globalThis.crypto, 'getRandomValues')
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    writable: true,
    value: <T extends ArrayBufferView>(array: T): T => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (let i = 0; i < bytes.length; i += 32) bytes.set(next().subarray(0, Math.min(32, bytes.length - i)), i)
      return array
    },
  })
  Math.random = () => next().readUInt32BE(0) / 2 ** 32
  nodeCrypto.randomBytes = (size: number) => {
    const bytes = Buffer.alloc(size)
    for (let i = 0; i < size; i += 32) next().copy(bytes, i, 0, Math.min(32, size - i))
    return bytes
  }
  return () => {
    Math.random = random
    nodeCrypto.randomBytes = randomBytes
    if (own === undefined) delete (globalThis.crypto as unknown as Record<string, unknown>).getRandomValues
    else Object.defineProperty(globalThis.crypto, 'getRandomValues', own)
  }
}

/**
 * A run whose world is the seed's own: the mock's factory and seed, run on
 * the run's file at the epoch, then each table checked against its digest.
 */
async function seedTheRun(spec: UpstreamSpec, bundled: () => Promise<string>, file: string, epoch: string | undefined): Promise<void> {
  // A reset with no epoch (the fake's own first run) is on the wall clock,
  // as the kit's clock is; the digest, the epoch's, is not checked then.
  const startMs = epoch === undefined ? Date.now() : Date.parse(epoch)
  if (Number.isNaN(startMs)) throw new Error(`the epoch ${epoch} is not a date`)
  const copy = await load(await bundled())
  const connection = openRun(file, () => startMs)
  try {
    const env = connection.prepare('SELECT name, value FROM "_env"').all() as { name: string; value: string }[]
    copy.vfsbench.configure({ env: { ...spec.env, ...Object.fromEntries(env.map((e) => [e.name, e.value])) }, map: spec.map, startMs, files: {} })
    const expected = connection.prepare('SELECT name, value FROM "_seed"').all() as { name: string; value: string }[]
    const draws = Number(expected.find((e) => e.name === 'draws:import')?.value ?? 0)
    copy.vfsbench.enter(connection, startMs)
    let seeded: unknown
    // Counted from here to the seed's end, with no await between, so no
    // other run's request draws in between.
    const restore = countRandom(draws, spec.random)
    try {
      // As upstream's startServer: the factory, then its seed.
      seeded = copy.create().seed?.()
    } finally {
      restore()
      copy.vfsbench.leave()
    }
    await seeded
    if (epoch === undefined) return
    const want = new Map(expected.map((e) => [e.name, e.value]))
    const tables = expected.filter((e) => e.name.startsWith(seedRow(''))).map((e) => e.name.slice(seedRow('').length))
    const got = digest(tables, (sql) => connection.prepare(sql).all())
    const differ = tables.filter((t) => got[t] !== want.get(seedRow(t)))
    if (differ.length > 0) {
      const each = differ.map((t) => `${t}: ${got[t]}, not ${want.get(seedRow(t))}`)
      throw new Error(`the seed of ${spec.entry} differs from its fixture's digest: ${each.join('; ')}`)
    }
  } finally {
    connection.close()
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
          // A run seeded by the mock itself is its database, where the seed
          // finds its rows and skips.
          const own = seedsRun(connection)
          if (own) copy.vfsbench.enter(connection, startMs)
          try {
            const app = copy.create()
            await app.seed?.()
            return { copy, app }
          } finally {
            if (own) copy.vfsbench.leave()
          }
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
    afterSeed: async (db, _tenant, _counts, _extras, _root, epoch) => {
      const connection = openRun(db.file, () => Date.now())
      const own = (() => {
        try {
          return seedsRun(connection)
        } finally {
          connection.close()
        }
      })()
      if (own) await seedTheRun(spec, () => (bundled ??= bundle(spec.entry, spec.factory)), db.file, epoch)
      afterSeed(db.file)
    },
    afterReset: (db) => {
      copies.delete(db)
    },
    routes: (): KitRoute<C>[] =>
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) =>
        route<C>(method, '/*rest', (ctx) => answer(method, ctx), { write: true }),
      ),
  }
}
