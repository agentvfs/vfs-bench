/**
 * ERPBench-100's world as a kit fake. A run is one task's world: the
 * fixture names the task (`_seed.task`), and `afterSeed` makes the run's
 * file from the world upstream seeds for it (convert.py's
 * `state/erpbench/kit/<task>.json`, never in the workspace), plus `_trace`.
 *
 *     POST /<tool>   a tool by its full name (`oracle_fusion.sales_orders.create`),
 *                    its arguments the JSON body. Upstream's `ErpWorld.call_tool`:
 *                    the result as `json.dumps(sort_keys=True)`, 200; an error
 *                    `{"error": ...}`, 400. Each call appends upstream's trace
 *                    entry (`_record`) to `_trace`, which its grader reads.
 *     GET /gmail/v1/..., /drive/v3/..., /v4/spreadsheets/..., /slack/api/...
 *                    the Gmail, Drive, Sheets and Slack APIs Mirage's mounts
 *                    read, from the same world (routes.ts); a read stands for
 *                    an upstream read tool and is recorded as one, with its
 *                    witness in `_seen`.
 *
 * The CLI sends a whole float as an int, so before dispatch a value its
 * tool's schema types `number` becomes a float, as Python's `1250.0`.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PyFloat } from '../../../../workspace/py.ts'
import type { VerifierQuery } from '../../../enterpriseops/mocks/enterpriseops/fake.ts'
import { loads } from '../../../enterpriseops/mocks/enterpriseops/py.ts'
import { Conn, SqliteError } from '../../../enterpriseops/mocks/enterpriseops/sqlite.ts'
import { Prisma } from './client/index.js'
import { ErpClient, config } from './config.ts'
import { type Dict, caught, deepcopy, dumps, isDict, put } from './py.ts'
import { restRoutes } from './routes.ts'
import { kitOf, kitOfRun, record } from './run.ts'
import { World, snapshot } from './world.ts'

/** A value the schema types `number` as a float; objects and arrays by their properties and items. */
function coerce(v: unknown, schema: unknown): unknown {
  if (!isDict(schema)) return v
  if (schema.type === 'number' && (typeof v === 'number' || typeof v === 'bigint')) return new PyFloat(Number(v))
  if (schema.type === 'object' && isDict(v) && isDict(schema.properties)) {
    for (const [k, s] of Object.entries(schema.properties)) if (Object.hasOwn(v, k)) put(v, k, coerce(v[k], s))
  }
  if (schema.type === 'array' && Array.isArray(v)) return v.map((x) => coerce(x, schema.items))
  return v
}

function reply(status: number, value: unknown): Reply {
  return { status, body: Buffer.from(dumps(value)), headers: { 'Content-Type': 'application/json' } }
}

/** `ErpWorld.call_tool`, then `_record` into `_trace`. */
function call(ctx: Ctx<ErpClient>): Reply {
  const tool = ctx.params.tool!
  const conn = new Conn(ctx.db.file, () => ctx.clock.nowMs())
  try {
    const kit = kitOfRun(conn)
    const body = ctx.body.length === 0 ? {} : loads<unknown>(ctx.body.toString('utf8'))
    const definition = kit.tools.find((t) => t.name === tool)
    const args = (isDict(body) ? coerce(body, definition?.inputSchema) : {}) as Dict
    let success = false
    let result: Dict
    if (definition === undefined) result = { error: `unknown tool: ${tool}` }
    else {
      try {
        result = new World(kit, conn).dispatch(tool, deepcopy(args))
        success = true
      } catch (error) {
        if (!caught(error) && !(error instanceof SqliteError)) throw error
        conn.rollback()
        result = { error: error.message || (error as { kind?: string }).kind || error.constructor.name }
      }
    }
    record(conn, tool, args, success, result)
    conn.commit()
    return reply(success ? 200 : 400, result)
  } finally {
    conn.close()
  }
}

/**
 * The state view's queries (workspace/fake-state.ts): what upstream's grader
 * reads. `baseline` is the world as seeded (`ErpWorld.create`, replayed in
 * memory), `snapshot` the run's world now, `trace` its calls, `model` the
 * task's world model, `seen` the mount reads' arrival times and witnesses.
 * Each is one row whose `json` is the value as `json.dumps` writes it, so
 * floats stay floats.
 */
function verifierQuery(db: ErpClient, query: string, nowMs: number): ReturnType<VerifierQuery<ErpClient>> {
  const answer = (json: string) => ({ rows: [{ json }] })
  const conn = new Conn(db.file, () => nowMs)
  try {
    if (query === 'snapshot') return answer(dumps(snapshot(conn)))
    if (query === 'trace') return answer(`[${conn.execute('SELECT entry FROM _trace ORDER BY idx').fetchall().map((row) => row.entry).join(', ')}]`)
    if (query === 'seen') {
      const rows = conn.execute('SELECT idx, at_ms, witness FROM _seen ORDER BY idx').fetchall()
      return answer(JSON.stringify(rows.map((row) => ({ idx: row.idx, at_ms: row.at_ms, witness: JSON.parse(row.witness as string) }))))
    }
    if (query !== 'model' && query !== 'baseline') return { error: `unknown query: ${query}` }
    const kit = kitOfRun(conn)
    if (query === 'model') return answer(dumps(kit.model))
    const seeded = new Conn(':memory:', () => nowMs)
    try {
      seeded.executescript(kit.sql)
      return answer(dumps(snapshot(seeded)))
    } finally {
      seeded.close()
    }
  } finally {
    conn.close()
  }
}

export const fake: Fake<ErpClient> & { verifierQuery: VerifierQuery<ErpClient> } = {
  verifierQuery,
  config,
  client: ErpClient,
  dmmf: Prisma.dmmf as unknown as Dmmf,
  seedRoots: { seed: 'Seed' },
  afterSeed: async (db) => {
    const row = await db.seed.findFirst()
    if (row === null) return
    const conn = new Conn(db.file, () => Date.now())
    try {
      conn.executescript(kitOf(row.task).sql)
      conn.executescript('CREATE TABLE _trace (idx INTEGER PRIMARY KEY, entry TEXT NOT NULL)')
      conn.executescript('CREATE TABLE _seen (idx INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, witness TEXT NOT NULL)')
    } finally {
      conn.close()
    }
  },
  routes: () => [...restRoutes(), route<ErpClient>('POST', '/:tool', call, { write: true })],
}
