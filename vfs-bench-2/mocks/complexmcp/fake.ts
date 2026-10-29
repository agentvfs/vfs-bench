/**
 * A ComplexMCP server as a kit fake. Each Light app's run is a login of the
 * task's (`login` in its fixture); the fake makes the task's whole world
 * (world.ts) and keeps its own app's session, field by field, in the run's
 * SQLite.
 *
 *     POST /<tool>   a tool, its arguments the JSON body; the reply is the
 *                    text upstream's client hands the model, as a JSON string
 *     POST /login    what upstream's login answered, `session_info`
 *     POST /logout   what logout answers now: the end state the judge reads
 *
 * A Light app reaches LightSystem's clock as upstream's `OSConnector` does,
 * over HTTP: the request names the run of LightSystem's fake in
 * `x-light-system` (the CLI's config), and the app posts `/_step`,
 * `/_gen_past` and `/now` there. An app the task does not log into answers
 * every tool as upstream's client does, "<App> has not been logged into
 * yet."
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { parseConfig, route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Os } from './common.ts'
import { dumps, loads, toJson } from './py.ts'
import { type Clock, LightSystem } from './system.ts'
import { type App, type Tools, call, clientError } from './tool.ts'
import { APPS, type AppName, login } from './world.ts'

/** The part of a server's Prisma client the store uses: every server's is the same schema. */
export interface Db {
  login: { findFirst(): Promise<{ seed: number; apps: string } | null> }
  session: {
    findMany(): Promise<{ key: string; value: string }[]>
    upsert(args: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }): Promise<unknown>
  }
  $disconnect(): Promise<void>
}

/** A server's kit config: its schema is this directory's, linked from its own. */
export function serverConfig(service: string, dir: string) {
  return parseConfig({ service, schema: join(dir, `${service}.prisma`), tenantKind: 'none' })
}

/** A run's stored session, field by field, and the text each field was read as. */
interface Stored {
  data: Record<string, unknown>
  text: Map<string, string>
}

async function read(db: Db): Promise<Stored | null> {
  const rows = await db.session.findMany()
  if (rows.length === 0) return null
  const text = new Map(rows.map((r) => [r.key, r.value]))
  const data: Record<string, unknown> = {}
  for (const [key, value] of text) if (!key.startsWith('_')) data[key] = loads(value)
  return { data, text }
}

/** Write back the fields that changed; most of a world never does. */
async function write(db: Db, data: Record<string, unknown>, before?: Map<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(data)) {
    const text = dumps(value)
    if (before?.get(key) === text) continue
    await db.session.upsert({ where: { key }, create: { key, value: text }, update: { value: text } })
  }
}

/** LightSystem's clock in another fake, reached as upstream's connector reaches it. */
function remoteOs(url: string | undefined): Os {
  const post = async (path: string, body: unknown) => {
    if (url === undefined) throw new Error('no x-light-system: this request names no LightSystem run')
    const reply = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const out = (await reply.json()) as { status: string; output: unknown }
    if (out.status !== 'ok') throw new Error(`LightSystem${path}: ${JSON.stringify(out)}`)
    return out.output
  }
  return {
    now: async () => (await post('/_now', {})) as string,
    step: async () => (await post('/_step', {})) as string,
    genPast: async (startYear, k) => (await post('/_gen_past', { start_year: startYear, k })) as string[],
  }
}

/** The text the model is handed, as a JSON string. */
const text = (body: string): Reply => ({ status: 200, body })
/** A value as JSON, floats as Python's. */
const json = (body: unknown): Reply => raw(toJson(body))
const raw = (body: string): Reply => ({ status: 200, body: Buffer.from(body), headers: { 'Content-Type': 'application/json' } })

function header(ctx: Ctx<unknown>, name: string): string | undefined {
  const v = ctx.headers[name]
  return Array.isArray(v) ? v[0] : v
}

/** A stand-in for upstream's session id, `session_` and 22 of shortuuid's alphabet. */
function sessionId(run: string): string {
  const digest = createHash('sha256').update(run).digest()
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return `session_${Array.from(digest.subarray(0, 22), (b) => alphabet[b % alphabet.length]).join('')}`
}

/** A Light app's routes over the run's session. */
function lightRoutes<D extends Db>(name: AppName): KitRoute<D>[] {
  const app = APPS[name] as App<unknown, unknown>
  const loaded = async (ctx: Ctx<D>) => {
    const stored = await read(ctx.db)
    if (stored === null) return null
    const os = remoteOs(header(ctx, 'x-light-system'))
    return { stored, session: app.load(stored.data, os) }
  }
  const tools = Object.keys(app.tools).map((tool) =>
    route<D>('POST', `/${tool}`, async (ctx) => {
      const run = await loaded(ctx)
      if (run === null) return text(clientError('failed', `${name} has not been logged into yet.`))
      const args = ctx.body.length === 0 ? {} : loads<Record<string, unknown>>(ctx.body.toString('utf8'))
      try {
        // Upstream's client adds the session's id to the arguments, which a
        // validation error prints: the run's stands in for it.
        return text(await call(app.tools, tool, run.session, args, { session_id: sessionId(ctx.run) }))
      } finally {
        // Upstream's session is changed in place, so a tool that raises
        // keeps what it changed first, as it does there.
        await write(ctx.db, app.save(run.session) as Record<string, unknown>, run.stored.text)
      }
    }, { write: true }),
  )
  const own: KitRoute<D>[] = [
    ...tools,
    route<D>('POST', '/login', async (ctx) => {
      const stored = await read(ctx.db)
      return stored === null ? json({ status: 'failed', output: 'session not found' }) : raw(stored.text.get('_login')!)
    }),
    route<D>('POST', '/logout', async (ctx) => {
      const run = await loaded(ctx)
      return run === null ? json({ status: 'failed', output: 'session not found' }) : json({ status: 'ok', output: app.sessionDict(run.session) })
    }),
  ]
  if (name === 'LightSystem') {
    const clock = async (ctx: Ctx<D>, work: (c: Clock) => unknown) => {
      const run = await loaded(ctx)
      if (run === null) return json({ status: 'failed', output: 'session not found' })
      const out = work(run.session as Clock)
      await write(ctx.db, LightSystem.save(run.session as Clock) as unknown as Record<string, unknown>, run.stored.text)
      return json(out)
    }
    own.push(
      route<D>('POST', '/_now', (ctx) => clock(ctx, (c) => c.nowResult())),
      route<D>('POST', '/_step', (ctx) => clock(ctx, (c) => c.step()), { write: true }),
      route<D>('POST', '/_gen_past', (ctx) => {
        const { start_year, k } = loads<{ start_year: number; k: number }>(ctx.body.toString('utf8'))
        return clock(ctx, (c) => c.genPast(start_year, k))
      }, { write: true }),
    )
  }
  return own
}

/** A Light app's fake: its run is the task's login, which `afterSeed` makes. */
export function lightFake<C extends Db>(
  name: AppName,
  config: ReturnType<typeof serverConfig>,
  client: new (options: { datasourceUrl: string }) => C,
  dmmf: Dmmf,
): Fake<C> {
  return {
    config,
    client,
    dmmf,
    seedRoots: { login: 'Login' },
    afterSeed: async (db) => {
      const row = await db.login.findFirst()
      if (row === null) return
      const apps = JSON.parse(row.apps) as AppName[]
      if (name !== 'LightSystem' && !apps.includes(name)) return
      const world = await login(row.seed, apps)
      const app = APPS[name] as App<unknown, unknown>
      const data = world[name] as Record<string, unknown>
      await write(db, data)
      const session = app.load(data, remoteOs(undefined))
      const info = { status: 'ok', output: app.sessionDict(session) }
      await db.session.upsert({ where: { key: '_login' }, create: { key: '_login', value: toJson(info) }, update: { value: toJson(info) } })
    },
    routes: () => lightRoutes<C>(name),
  }
}


/**
 * A plain server's fake (MathServer and the rest): its tools keep nothing,
 * so a run is empty and every call is the tool's answer alone.
 */
export function plainFake<C extends Db>(
  tools: Tools<null>,
  config: ReturnType<typeof serverConfig>,
  client: new (options: { datasourceUrl: string }) => C,
  dmmf: Dmmf,
): Fake<C> {
  return {
    config,
    client,
    dmmf,
    routes: () =>
      Object.keys(tools).map((tool) =>
        route<C>('POST', `/${tool}`, async (ctx) => {
          const args = ctx.body.length === 0 ? {} : loads<Record<string, unknown>>(ctx.body.toString('utf8'))
          return text(await call(tools, tool, null, args))
        }),
      ),
  }
}
