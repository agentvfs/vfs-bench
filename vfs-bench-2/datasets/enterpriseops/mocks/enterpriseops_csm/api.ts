/**
 * How upstream's CSM server answers a tool (sn-csm-server, from its image's
 * bytecode): the MCP handler posts the arguments, with the database's id,
 * to the server's own `/tools/<tool>` route; FastAPI reads them into the
 * route's pydantic model, the route calls `CSMManager`, and the handler
 * hands the model `json.dumps` of the route's JSON. What fails comes back
 * as `API Error [<tool>]: <detail>`, an error: a `ValueError` from the
 * manager as a 400 with its text, a model the body does not fit as FastAPI's
 * 422 list, anything else as a 500.
 *
 * `route(model, work)` is one route: `work` gets the run's connection and
 * the body as the model read it (`body.model_dump(exclude={'database_id'})`),
 * and returns the route's JSON.
 */
import { HTTPException, ValueError } from '../enterpriseops/errors.ts'
import type { Tool, ToolCtx } from '../enterpriseops/fake.ts'
import { type Model, detailText, validate } from '../enterpriseops/model.ts'
import { dumps, str } from '../enterpriseops/py.ts'
import type { Conn } from '../enterpriseops/sqlite.ts'

export interface Body {
  /** The body's fields as the model read them, defaults filled in. */
  value: Record<string, unknown>
  /**
   * The fields the body gave (`model_dump(exclude_unset=True)`). Upstream's
   * update routes dump with `exclude_none` instead: they read `value`'s non-null fields.
   */
  set: Set<string>
}

export interface Work {
  /** The run's database, as `CSMManager._connect` opens it: foreign keys on. */
  conn: () => Conn
  /** `datetime.utcnow().isoformat(' ', 'seconds')`. */
  now: () => string
}

/** A route as a tool: `work` returns the route's JSON, or raises as upstream's route does. */
export function route(tool: string, model: Model, work: (w: Work, body: Body) => unknown): Tool {
  return (args: Record<string, unknown>, ctx: ToolCtx) => {
    const fail = (detail: unknown) => ({ text: `API Error [${tool}]: ${typeof detail === 'string' ? detail : str(detail)}`, isError: true })
    // FastAPI reads the body upstream's handler posts: the database's id, then the arguments.
    const checked = validate(model, { database_id: ctx.databaseId(), ...args })
    if (!checked.ok) return fail(detailText(checked.errors))
    const opened: Conn[] = []
    const w: Work = {
      conn: () => {
        const conn = ctx.open()
        conn.execute('PRAGMA foreign_keys = ON')
        opened.push(conn)
        return conn
      },
      now: () => new Date(ctx.now()).toISOString().slice(0, 19).replace('T', ' '),
    }
    try {
      const out = work(w, { value: checked.value, set: new Set(Object.keys(args).filter((k) => k in model)) })
      return { text: dumps(out) }
    } catch (error) {
      if (error instanceof HTTPException) return fail(error.detail)
      if (error instanceof ValueError) return fail(error.message)
      return fail(error instanceof Error ? error.message : String(error))
    } finally {
      for (const conn of opened) conn.close()
    }
  }
}

/** `dict(row) if row else {}`. */
export function rowDict<T>(row: T | null): T | Record<string, never> {
  return row ?? {}
}
