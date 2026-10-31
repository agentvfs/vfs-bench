/**
 * ERPBench-100's world as a kit fake. A run is one task's world: the
 * fixture names the task (`_seed.task`), and `afterSeed` makes the run's
 * file from the world upstream seeds for it (the exporter's
 * `state/erpbench/kit/<task>.json`, never in the workspace), plus `_trace`.
 *
 *     POST /<tool>   a tool by its full name (`oracle_fusion.sales_orders.create`),
 *                    its arguments the JSON body. Upstream's `ErpWorld.call_tool`:
 *                    the result as `json.dumps(sort_keys=True)`, 200; an error
 *                    `{"error": ...}`, 400. Each call appends upstream's trace
 *                    entry (`_record`) to `_trace`, which its grader reads.
 *
 * The CLI sends a whole float as an int, so before dispatch a value its
 * tool's schema types `number` becomes a float, as Python's `1250.0`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PyFloat } from '../complexmcp/py.ts'
import { loads } from '../enterpriseops/py.ts'
import { Conn, SqliteError } from '../enterpriseops/sqlite.ts'
import { Prisma } from './client/index.js'
import { ErpClient, config } from './config.ts'
import { type Dict, caught, deepcopy, dumps, isDict, put } from './py.ts'
import { type Kit, SERVER_BY_PREFIX, World } from './world.ts'

/** Upstream's checkout and the exporter's per-task kits. */
export const STATE = process.env.ERPBENCH_STATE ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'state', 'erpbench')

const kits = new Map<string, Kit>()

/** A task's kit, read once per process. */
function kitOf(task: string): Kit {
  let kit = kits.get(task)
  if (kit === undefined) {
    if (!/^erpbench-\d+$/.test(task)) throw new Error(`not an ERPBench task: ${task}`)
    kit = loads<Kit>(readFileSync(join(STATE, 'kit', `${task}.json`), 'utf8'))
    kits.set(task, kit)
  }
  return kit
}

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
    const kit = kitOf(String(conn.execute('SELECT task FROM _seed').fetchone()?.task))
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
    const index = (conn.execute('SELECT COUNT(*) AS n FROM _trace').fetchone()!.n as number) + 1
    const entry = { index, server: SERVER_BY_PREFIX[tool.split('.')[0]!] ?? 'erpbench', tool, arguments: deepcopy(args), success, result: deepcopy(result) }
    conn.execute('INSERT INTO _trace (idx, entry) VALUES (?, ?)', [index, dumps(entry)])
    conn.commit()
    return reply(success ? 200 : 400, result)
  } finally {
    conn.close()
  }
}

export const fake: Fake<ErpClient> = {
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
    } finally {
      conn.close()
    }
  },
  routes: () => [route<ErpClient>('POST', '/:tool', call, { write: true })],
}
