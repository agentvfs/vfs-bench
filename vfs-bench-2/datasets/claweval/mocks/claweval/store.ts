/**
 * What every Claw-Eval service's fake shares: its store, its audit log, its
 * request models and its kit wiring.
 *
 * Upstream is claw-eval/claw-eval's mock services (@ 5680b8b, MIT,
 * mock_services/<service>/server.py), one FastAPI process per service, each
 * holding Python lists of dicts. Here each list is the run's `doc` rows of
 * its kind (claweval.prisma), read whole and written back whole, so a
 * handler is upstream's, statement for statement, over plain arrays. The
 * time upstream logs, `datetime.now(timezone.utc).isoformat()`, is the
 * run's clock, which ticks a whole second per call, so it prints as Python
 * prints a time with no microseconds.
 *
 * Upstream's error injection (`_base.py`) is off unless `ERROR_RATE` is
 * set, which no task in scope sets; it is left out.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig, route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, JsonValue, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Upstream's checkout, which `claweval/setup.py` downloads. */
export const UPSTREAM = process.env.CLAWEVAL_SRC ?? join(HERE, '..', '..', '..', '..', 'state', 'claweval', 'src')

export type Json = JsonValue
export type Dict = Record<string, Json>

/** The part of a service's Prisma client the store uses: every service's is the same schema. */
export interface Db {
  doc: {
    findMany(args: { where: { kind: string }; orderBy: { seq: 'asc' }; select: { doc: true } }): Promise<{ doc: string }[]>
    deleteMany(args: { where: { kind: string } }): Promise<unknown>
    createMany(args: { data: { kind: string; doc: string }[] }): Promise<unknown>
    create(args: { data: { kind: string; doc: string } }): Promise<unknown>
  }
  auditCall: {
    create(args: { data: { endpoint: string; request_body: string; response_body: string; timestamp: string } }): Promise<unknown>
    findMany(args: { orderBy: { seq: 'asc' } }): Promise<{ endpoint: string; request_body: string; response_body: string; timestamp: string }[]>
  }
  $disconnect(): Promise<void>
}

/** A list of upstream's, as it stands in the run. */
export async function load(db: Db, kind: string): Promise<Dict[]> {
  const rows = await db.doc.findMany({ where: { kind }, orderBy: { seq: 'asc' }, select: { doc: true } })
  return rows.map((r) => JSON.parse(r.doc) as Dict)
}

/** Replace a list with `docs`, in order. */
export async function save(db: Db, kind: string, docs: Dict[]): Promise<void> {
  await db.doc.deleteMany({ where: { kind } })
  if (docs.length > 0) await db.doc.createMany({ data: docs.map((d) => ({ kind, doc: JSON.stringify(d) })) })
}

/** Upstream's `list.append`. */
export async function append(db: Db, kind: string, doc: Dict): Promise<void> {
  await db.doc.create({ data: { kind, doc: JSON.stringify(doc) } })
}

/** `datetime.now(timezone.utc).isoformat()` at the run's clock, which has no microseconds. */
export function pyNow(ctx: Ctx<unknown>): string {
  return ctx.clock.nowIso(false).replace(/Z$/, '+00:00')
}

/** Upstream's `_log_call`. */
export async function logCall(ctx: Ctx<Db>, endpoint: string, request: Json, response: Json): Promise<void> {
  await ctx.db.auditCall.create({
    data: { endpoint, request_body: JSON.stringify(request), response_body: JSON.stringify(response), timestamp: pyNow(ctx) },
  })
}

/** Upstream's audit log, `_audit_log`, as its `/audit` route lists it. */
export async function calls(db: Db): Promise<Dict[]> {
  const rows = await db.auditCall.findMany({ orderBy: { seq: 'asc' } })
  return rows.map((r) => ({
    endpoint: r.endpoint,
    request_body: JSON.parse(r.request_body) as Json,
    response_body: JSON.parse(r.response_body) as Json,
    timestamp: r.timestamp,
  }))
}

/** A pydantic field: required, or its default. */
export type Field = { required: true } | { default: Json }
export const REQUIRED: Field = { required: true }
export const opt = (value: Json): Field => ({ default: value })

/**
 * A request body as upstream's pydantic model reads it: each field in the
 * model's order, `model_dump()`'s, with its default where the body leaves it
 * out, and fields the model lacks dropped. A body that is not an object,
 * or lacks a required field, is FastAPI's 422. `optional` is a model
 * declared `Model | None = None`, which an empty body or `null` leaves at
 * its defaults. Values are taken as sent: the CLIs send each flag typed by the
 * tool's schema, so pydantic's coercions do not come up.
 */
export function model(ctx: Ctx<unknown>, fields: Record<string, Field>, optional = false): Dict | Reply {
  let body: unknown
  if (ctx.body.length === 0) {
    if (optional) body = {}
    else return unprocessable([{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }])
  } else {
    try {
      body = JSON.parse(ctx.body.toString('utf8'))
    } catch {
      return unprocessable([{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
    }
  }
  // A `Model | None` takes JSON null as no model, so its defaults.
  if (optional && body === null) body = {}
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return unprocessable([{ type: 'model_attributes_type', loc: ['body'], msg: 'Input should be a valid dictionary or object to extract fields from', input: body as Json }])
  }
  const given = body as Dict
  const out: Dict = {}
  const missing: Dict[] = []
  for (const [name, field] of Object.entries(fields)) {
    if (name in given) out[name] = given[name]!
    else if ('default' in field) out[name] = field.default
    else missing.push({ type: 'missing', loc: ['body', name], msg: 'Field required', input: given })
  }
  return missing.length > 0 ? unprocessable(missing) : out
}

/** FastAPI's validation error. */
function unprocessable(detail: Dict[]): Reply {
  return { status: 422, body: { detail } }
}

export function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'status' in value && typeof (value as Reply).status === 'number'
}

export const ok = (body: Json): Reply => ({ status: 200, body })

/**
 * Starlette's 404 for a path no route answers, and its 405 for a path one
 * answers under another method.
 */
export function unrouted<C>(routes: KitRoute<C>[]): KitRoute<C>[] {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) =>
    route<C>(method, '/*rest', (ctx) =>
      routes.some((r) => r.pattern.test(`/${ctx.params.rest ?? ''}`))
        ? { status: 405, body: { detail: 'Method Not Allowed' } }
        : { status: 404, body: { detail: 'Not Found' } },
    ),
  )
}

/** A Claw-Eval service's kit config: its schema is this directory's, linked from its own. */
export function serviceConfig(service: string, dir: string) {
  return parseConfig({ service, schema: join(dir, `${service}.prisma`), tenantKind: 'none' })
}

/**
 * A service's fake. A fixture names upstream's lists by `doc` rows of their
 * kind, and starts the audit log empty, as upstream's `/reset` leaves it.
 */
export function serviceFake<C extends Db>(
  config: ReturnType<typeof serviceConfig>,
  client: new (options: { datasourceUrl: string }) => C,
  dmmf: Dmmf,
  routes: () => KitRoute<C>[],
): Fake<C> {
  return {
    config,
    client,
    dmmf,
    seedRoots: Object.fromEntries(dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m.name])),
    routes: () => {
      const own = routes()
      return [...own, ...unrouted(own)]
    },
  }
}
