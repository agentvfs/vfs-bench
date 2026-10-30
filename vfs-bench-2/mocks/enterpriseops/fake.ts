/**
 * An EnterpriseOps-Gym server as a kit fake. A run is one of upstream's
 * databases (its `x-database-id`): the fixture names the task's seed, and
 * `afterSeed` makes the run's file as upstream's `/api/seed-database` makes
 * one, from the server's own CREATE TABLE statements (`schema.sql`) and the
 * seed's SQL. Every tool is a port of upstream's, SQL on that file
 * (`sqlite.ts`).
 *
 *     POST /<tool>          a tool, its arguments the JSON body. The reply is
 *                           the text upstream's server hands the model: its
 *                           JSON as it is, or the text as a JSON string; an
 *                           error (upstream's `isError`) is a 400.
 *     POST /api/sql-runner  upstream's verifier's read-only SELECT, as
 *                           upstream's servers answer it.
 *
 * The caller is the CLI's `x-user-email` header, as upstream's client sends
 * the task's user.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig, route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, KitRoute, MinimalClient, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { dumps, loads } from './py.ts'
import { Conn, SqliteError } from './sqlite.ts'

/** Upstream's checkout and seeds, as enterpriseops/setup.py fetches them. */
export const STATE =
  process.env.ENTERPRISEOPS_STATE ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'state', 'enterpriseops')

/** Where a seed's path in a task (`gym_servers_config`'s `seed_database_file`) is read from. */
export const SEEDS = join(STATE, 'dbs')

/** A run's client, which knows its own file: the tools run their SQL on it. */
export interface RunClient extends MinimalClient {
  readonly file: string
  seed: { findFirst(): Promise<{ db: string } | null> }
}

/** What a tool gets besides its arguments. */
export interface ToolCtx {
  /** The run's file, as upstream's `sqlite3.connect` opens it. */
  open(): Conn
  /** The run's clock, in ms: the same instant for the whole call. */
  now(): number
  /**
   * The database's id, as upstream's client sends it (`x-database-id`):
   * the seed's, which upstream's errors print.
   */
  databaseId(): string
  /** The caller, as upstream's client names it (`x-user-email`). */
  userEmail: string | undefined
  headers: Record<string, string | undefined>
}

/** A tool's reply: the text upstream's server hands the model, and whether it is an error. */
export interface ToolReply {
  text: string
  isError?: boolean
}

export type Tool = (args: Record<string, unknown>, ctx: ToolCtx) => ToolReply | Promise<ToolReply>

export interface ServerSpec {
  /** The server's tools by name, each a port of upstream's. */
  tools: Record<string, Tool>
  /**
   * What upstream's server checks before any tool, from the request's
   * headers (that the caller is a user of the database, say): a reply
   * stops the call there.
   */
  before?: (ctx: ToolCtx, tool: string) => ToolReply | null
  /** Make a run's database as upstream's `/api/seed-database` makes one: its tables, then the seed. */
  seed: (conn: Conn, schema: string, sql: string) => void
  /** Upstream's CREATE TABLE statements, as the server makes its tables. */
  schema: string
  /** The rows upstream's SQL runner returns at most, unless the query says (its `limit`). */
  sqlLimit?: number
}

/** A server's kit config: its schema is this directory's, linked from its own. */
export function serverConfig(service: string, dir: string) {
  return parseConfig({ service, schema: join(dir, `${service}.prisma`), tenantKind: 'none' })
}

function header(ctx: Ctx<unknown>, name: string): string | undefined {
  const v = ctx.headers[name]
  return Array.isArray(v) ? v[0] : v
}

/** A JSON body as Python's `json.loads` reads it, floats as floats. */
function body(ctx: Ctx<unknown>): Record<string, unknown> {
  if (ctx.body.length === 0) return {}
  const value = loads<unknown>(ctx.body.toString('utf8'))
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The text as the CLI prints it: JSON stays JSON, other text a JSON string. */
function asReply(reply: ToolReply): Reply {
  let json = true
  try {
    JSON.parse(reply.text)
  } catch {
    json = false
  }
  const text = json ? reply.text : JSON.stringify(reply.text)
  return { status: reply.isError ? 400 : 200, body: Buffer.from(text), headers: { 'Content-Type': 'application/json' } }
}

function toolCtx<C extends RunClient>(ctx: Ctx<C>): ToolCtx {
  let at: number | undefined
  const headers: Record<string, string | undefined> = {}
  for (const name of Object.keys(ctx.headers)) headers[name.toLowerCase()] = header(ctx, name)
  const now = () => (at ??= ctx.clock.nowMs())
  return {
    open: () => new Conn(ctx.db.file, now),
    now,
    databaseId: () => {
      const conn = new Conn(ctx.db.file, now)
      try {
        const db = String(conn.execute('SELECT db FROM _seed').fetchone()?.db ?? '')
        return db.replace(/^.*\//, '').replace(/\.sql$/, '')
      } finally {
        conn.close()
      }
    },
    userEmail: headers['x-user-email'],
    headers,
  }
}

/**
 * Upstream's `/api/sql-runner`: one read-only SELECT (or WITH, or
 * EXPLAIN), a LIMIT added unless it has one, each row as an object.
 */
function sqlRunner(conn: Conn, query: string, limit: number): Reply {
  const fail = (detail: string) => ({ status: 400, body: { detail } })
  let q = query.trim().replace(/;+$/, '').trim()
  if (q.includes(';')) return fail('Only a single SELECT statement is allowed')
  const head = q.trimStart().toUpperCase()
  const stripped = q.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, ' ')
  const forbidden =
    /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|VACUUM|ATTACH|DETACH|PRAGMA|REINDEX|ANALYZE|BEGIN|END|COMMIT|ROLLBACK)\b/i
  if (!(head.startsWith('SELECT') || head.startsWith('WITH') || head.startsWith('EXPLAIN')) || forbidden.test(stripped)) {
    return fail('Only read-only SELECT queries are allowed')
  }
  if (!q.toUpperCase().includes(' LIMIT ')) q = `${q} LIMIT ${limit}`
  try {
    const rows = conn.execute(q).fetchall()
    const text = dumps({
      success: true,
      message: `Query executed successfully, returned ${rows.length} rows`,
      data: rows,
      row_count: rows.length,
      query: q,
    })
    return { status: 200, body: Buffer.from(text), headers: { 'Content-Type': 'application/json' } }
  } catch (error) {
    return fail(`Query failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A server's fake: its run is the task's seeded database. */
export function serverFake<C extends RunClient>(
  spec: ServerSpec,
  config: ReturnType<typeof serverConfig>,
  client: new (options: { datasourceUrl: string }) => C,
  dmmf: Dmmf,
): Fake<C> {
  const schema = readFileSync(spec.schema, 'utf8')
  const routes = (): KitRoute<C>[] => [
    ...Object.entries(spec.tools).map(([name, tool]) =>
      route<C>(
        'POST',
        `/${name}`,
        async (ctx) => {
          const tctx = toolCtx(ctx)
          const stop = spec.before?.(tctx, name)
          if (stop) return asReply(stop)
          try {
            return asReply(await tool(body(ctx), tctx))
          } catch (error) {
            // Upstream's MCP layer catches what a tool raises.
            const message = error instanceof Error ? error.message : String(error)
            return asReply({ text: `Tool execution failed: ${message}`, isError: true })
          }
        },
        { write: true },
      ),
    ),
    route<C>('POST', '/api/sql-runner', (ctx) => {
      const { query, limit } = body(ctx) as { query?: unknown; limit?: unknown }
      if (typeof query !== 'string') return { status: 422, body: { detail: 'query is required' } }
      const conn = new Conn(ctx.db.file, () => ctx.clock.nowMs())
      try {
        return sqlRunner(conn, query, typeof limit === 'number' ? limit : (spec.sqlLimit ?? 100))
      } finally {
        conn.close()
      }
    }),
  ]
  return {
    config,
    client,
    dmmf,
    seedRoots: { seed: 'Seed' },
    afterSeed: async (db, _tenant, _counts, _extras, _root, epoch) => {
      const row = await db.seed.findFirst()
      if (row === null) return
      const sql = readFileSync(join(SEEDS, row.db), 'utf8')
      // A row the seed leaves a time to is stamped at the run's start.
      const start = epoch === undefined ? Date.now() : Date.parse(epoch)
      const conn = new Conn(db.file, () => start)
      try {
        spec.seed(conn, schema, sql)
        conn.commit()
      } catch (error) {
        throw error instanceof SqliteError ? new Error(`seeding ${row.db}: ${error.kind}: ${error.message}`) : error
      } finally {
        conn.close()
      }
    },
    routes,
  }
}
