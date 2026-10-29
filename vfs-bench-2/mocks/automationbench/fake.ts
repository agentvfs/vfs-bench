/**
 * The AutomationBench fake: upstream's three tools (tools/api), each a
 * route, `POST /<tool>`, whose JSON body is the tool's arguments as the
 * workspace's `api` CLI sends them (harbor/tools.ts), and whose reply is the
 * text the tool returns to the model, a JSON string. A run is one task's
 * world (`world.ts`), seeded from the fixture harbor/automationbench.py
 * writes.
 *
 * A call goes as upstream's environment makes it (`update_tool_args`): an
 * argument that is `{}` is dropped, the world is passed, and an exception the
 * tool lets out is its text (verifiers' `error_formatter`, `f"{e}"`), the
 * reply as any other. Only `api_fetch` changes the world, and each of its
 * calls moves the clock on by a second.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import './apps.ts'
import { config } from './config.ts'
import { apiFetch } from './fetch.ts'
import { type PyDict, PyError, dumps, isDict, loads } from './py.ts'
import { apiSearch, base64Encode } from './search.ts'
import { type Meta, World, bind, sig } from './world.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const HERE = dirname(fileURLToPath(import.meta.url))

interface Db {
  doc: {
    findUnique(args: { where: { name: string } }): Promise<{ name: string; doc: string } | null>
    upsert(args: { where: { name: string }; create: { name: string; doc: string }; update: { doc: string } }): Promise<unknown>
  }
}

const TOOLS = {
  api_fetch: sig('automationbench.tools.api.fetch', 'api_fetch', ['world', 'method', 'url', ['params', null], ['body', null]], false),
  api_search: sig('automationbench.tools.api.search', 'api_search', ['query', ['top_k', 5]], false),
  base64_encode: sig('automationbench.tools.api.encode', 'base64_encode', ['text'], false),
}

async function load(db: Db): Promise<World> {
  const world = await db.doc.findUnique({ where: { name: 'world' } })
  const meta = await db.doc.findUnique({ where: { name: 'meta' } })
  if (world === null || meta === null) throw new Error('the run has no world: its fixture names none')
  return new World(loads(world.doc) as PyDict, JSON.parse(meta.doc) as Meta)
}

async function save(db: Db, world: World): Promise<void> {
  const doc = dumps(world.data)
  await db.doc.upsert({ where: { name: 'world' }, create: { name: 'world', doc }, update: { doc } })
  const meta = JSON.stringify(world.meta())
  await db.doc.upsert({ where: { name: 'meta' }, create: { name: 'meta', doc: meta }, update: { doc: meta } })
}

/** One tool call, as upstream's environment makes it: the tool's text. */
export async function call(db: Db, tool: keyof typeof TOOLS, given: PyDict): Promise<string> {
  const args = Object.fromEntries(Object.entries(given).filter(([, v]) => !(isDict(v) && Object.keys(v).length === 0)))
  try {
    if (tool === 'api_search') {
      const a = bind(TOOLS.api_search, [], args)
      return apiSearch(a.query, a.top_k)
    }
    if (tool === 'base64_encode') return base64Encode(bind(TOOLS.base64_encode, [], args).text)
    const world = await load(db)
    world.calls += 1
    try {
      const a = bind(TOOLS.api_fetch, [], { ...args, world: null })
      return apiFetch(world, a.method as string, a.url as string, a.params, a.body)
    } finally {
      await save(db, world)
    }
  } catch (error) {
    if (error instanceof PyError) return error.message
    throw error
  }
}

async function answer(tool: keyof typeof TOOLS, ctx: Ctx<Db>): Promise<Reply> {
  let args: unknown = {}
  if (ctx.body.length > 0) args = loads(ctx.body.toString('utf8'))
  if (!isDict(args)) return { status: 400, body: 'the arguments must be a JSON object' }
  return { status: 200, body: await call(ctx.db, tool, args) }
}

export const automationbenchFake: Fake<PrismaClient> = {
  config,
  client: PrismaClient,
  dmmf: Prisma.dmmf as unknown as Dmmf,
  seedRoots: { doc: 'Doc' },
  routes: () => {
    const own: KitRoute<PrismaClient>[] = (Object.keys(TOOLS) as (keyof typeof TOOLS)[]).map((tool) =>
      route<PrismaClient>('POST', `/${tool}`, (ctx) => answer(tool, ctx as unknown as Ctx<Db>), { write: true }),
    )
    const missing = (ctx: Ctx<PrismaClient>): Reply => ({ status: 404, body: { detail: `No such tool: ${ctx.url.pathname}` } })
    return [...own, ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => route<PrismaClient>(method, '/*rest', missing))]
  },
}
