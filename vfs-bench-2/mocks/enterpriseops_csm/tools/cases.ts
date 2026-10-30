/**
 * CSM's case, case SLA and interaction tools: ports of `CSMManager`'s
 * methods and their routes (sn-csm-server's database/csm_manager.py and
 * apis/csm_apis.py, read from the image's bytecode).
 */
import { ValueError } from '../../enterpriseops/errors.ts'
import type { Tool } from '../../enterpriseops/fake.ts'
import { type FieldError, type Model, detailText, validate } from '../../enterpriseops/model.ts'
import { PyFloat } from '../../enterpriseops/py.ts'
import type { Conn, Params, Row, Value } from '../../enterpriseops/sqlite.ts'
import { route } from '../api.ts'
import { CASE_CHANNEL, CASE_PRIORITY, CASE_STATE, ESC_REASON } from './models.ts'

const INTERNAL = ['admin', 'agent', 'manager']
const SLA_STAGE = ['in_progress', 'paused', 'completed', 'canceled'] as const
const INTERACTION_STATUS = ['open', 'handled', 'closed'] as const
const SLA_STAGE_PATTERN = '^(in_progress|paused|completed|canceled)$'
const INTERACTION_STATUS_PATTERN = '^(open|handled|closed)$'

const opt = (type: Model[string]['type']) => ({ type, nullable: true }) as const
const OPT_INT = opt('int')
const OPT_STR = opt('str')
const OPT_BOOL = opt('bool')
const CHANNEL = opt({ enum: CASE_CHANNEL })
const PRIORITY = opt({ enum: CASE_PRIORITY })
const STATE = opt({ enum: CASE_STATE })

/**
 * A route whose model has `Field(None, pattern=...)` strings, which
 * `model.ts` does not check: pydantic's `string_pattern_mismatch`, in field
 * order among the model's other errors.
 */
function patterned(tool: string, model: Model, patterns: Record<string, string>, inner: Tool): Tool {
  return (args, ctx) => {
    const bad = Object.entries(patterns).filter(([k, p]) => typeof args[k] === 'string' && !new RegExp(p, 'u').test(args[k] as string))
    if (bad.length === 0) return inner(args, ctx)
    const body = { database_id: ctx.databaseId(), ...args }
    const checked = validate(model, body)
    const errors: FieldError[] = checked.ok ? [] : [...checked.errors]
    for (const [k, p] of bad) {
      errors.push({ type: 'string_pattern_mismatch', loc: ['body', k], msg: `String should match pattern '${p}'`, input: args[k], ctx: { pattern: p } })
    }
    const order = Object.keys(model)
    errors.sort((a, b) => order.indexOf(String(a.loc[1])) - order.indexOf(String(b.loc[1])))
    return { text: `API Error [${tool}]: ${detailText(errors)}`, isError: true }
  }
}

/** `' WHERE ' + ' AND '.join(clauses) if clauses else ''`. */
const where = (clauses: string[]) => (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '')

/** `x or 0.0` of an AVG. */
const avgOr0 = (v: Value | undefined) => (v === null || v === undefined || (v instanceof PyFloat && v.v === 0) ? new PyFloat(0) : v)

const flag = (v: unknown) => (v ? 1 : 0)

/** `conn.execute(sql, params).fetchall()` as `[dict(r) for r in rows]`. */
const all = (conn: Conn, sql: string, params: Params = []) => conn.execute(sql, params).fetchall()

/** `{r[key]: r['count'] for r in rows}`. */
function countsBy(rows: Row[], key: string): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (const r of rows) out[String(r[key])] = r.count!
  return out
}

/** The filter loops of `search_cases`, `find_case_slas` and the like: `(sql, conv)` per key, `None` skipped. */
function filtered(filters: Record<string, unknown>, m: Record<string, [string, ((v: unknown) => unknown)?]>) {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const [k, [sql, conv]] of Object.entries(m)) {
    const v = filters[k]
    if (v === null || v === undefined) continue
    clauses.push(sql)
    params.push(conv ? conv(v) : v)
  }
  return { clauses, params }
}

/** The case's row, as `dict(cur.execute('SELECT * ...').fetchone())`. */
const selectOne = (conn: Conn, table: string, key: string, id: unknown) => conn.execute(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]).fetchone()

/**
 * `updates` as the route hands it: `body.model_dump(exclude={...}, exclude_none=True)`
 * (a null given is dropped: upstream fills `ended_at` on a close with `ended_at: null`).
 */
function updatesOf(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (k !== 'database_id' && k !== key && v !== null && v !== undefined) out[k] = v
  return out
}

const given = (u: Record<string, unknown>, k: string) => k in u && u[k] !== null && u[k] !== undefined

const exists = (conn: Conn, sql: string, id: unknown) => conn.execute(sql, [id]).fetchone() !== null

function role(conn: Conn, userId: unknown, quoted: boolean): Value | undefined {
  const row = conn.execute(`SELECT role FROM ${quoted ? '"user"' : 'user'} WHERE user_id = ?`, [userId]).fetchone()
  return row === null ? undefined : row.role
}

/** `int(x)` of a column read back. */
function pyInt(v: Value): number | bigint {
  if (v === null) throw new TypeError("int() argument must be a string, a bytes-like object or a real number, not 'NoneType'")
  if (v instanceof PyFloat) return Math.trunc(v.v)
  if (typeof v === 'string') return Number(v.trim())
  return v as number | bigint
}

const same = (a: Value, b: unknown) => Number(pyInt(a)) === Number(b)

const SLA_FILTERS: Record<string, [string, ((v: unknown) => unknown)?]> = {
  case_sla_id: ['case_sla_id = ?'],
  case_id: ['case_id = ?'],
  sla_def_id: ['sla_def_id = ?'],
  stage: ['stage = ?'],
  start_time: ['start_time = ?'],
  breach_time: ['breach_time = ?'],
  has_breached: ['has_breached = ?', flag],
  completed_time: ['completed_time = ?'],
}

const FIND_CASE_SLAS: Model = {
  database_id: { type: 'str', required: true },
  case_sla_id: OPT_INT,
  case_id: OPT_INT,
  sla_def_id: OPT_INT,
  stage: OPT_STR,
  start_time: OPT_STR,
  breach_time: OPT_STR,
  has_breached: OPT_BOOL,
  completed_time: OPT_STR,
}

const FIND_STAGE: Model = { database_id: { type: 'str', required: true }, stage: OPT_STR }

const FIND_INTERACTIONS: Model = {
  database_id: { type: 'str', required: true },
  interaction_id: OPT_INT,
  channel: CHANNEL,
  account_id: OPT_INT,
  contact_id: OPT_INT,
  case_id: OPT_INT,
  interacted_user: OPT_INT,
  status: OPT_STR,
  started_at: OPT_STR,
  ended_at: OPT_STR,
  created_before: OPT_STR,
  created_after: OPT_STR,
  started_at_before: OPT_STR,
  started_at_after: OPT_STR,
  ended_at_before: OPT_STR,
  ended_at_after: OPT_STR,
}

/** `cur.execute(UPDATE ...)` and the row after, or `ValueError('<key> not found')`. */
function update(conn: Conn, table: string, key: string, id: unknown, sets: string[], params: unknown[]) {
  if (sets.length === 0) throw new ValueError('No fields to update')
  const cur = conn.execute(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${key} = ?`, [...params, id])
  if (cur.rowcount === 0) throw new ValueError(`${key} not found`)
  conn.commit()
  return selectOne(conn, table, key, id)
}

export const tools: Record<string, Tool> = {
  assign_case_to_user: route(
    'assign_case_to_user',
    { database_id: { type: 'str', required: true }, case_id: { type: 'int', required: true }, assigned_to_user_id: { type: 'int', required: true } },
    (w, { value: p }) => {
      const conn = w.conn()
      const r = role(conn, p.assigned_to_user_id, false)
      if (r === undefined) throw new ValueError('assigned_to user not found')
      if (!INTERNAL.includes(r as string)) throw new ValueError('assigned_to must be an internal user')
      const now = w.now()
      const cur = conn.execute('UPDATE customer_case SET assigned_to = ?, sys_updated_on = ? WHERE case_id = ?', [p.assigned_to_user_id, now, p.case_id])
      if (cur.rowcount === 0) throw new ValueError('case_id not found')
      conn.commit()
      return { assignment_status: 'success', assigned_to: p.assigned_to_user_id, assigned_at: now }
    },
  ),

  set_case_assignment_group: route(
    'set_case_assignment_group',
    { database_id: { type: 'str', required: true }, case_id: { type: 'int', required: true }, assignment_group_id: { type: 'int', required: true } },
    (w, { value: p }) => {
      const conn = w.conn()
      if (!exists(conn, 'SELECT 1 FROM user_group WHERE group_id = ?', p.assignment_group_id)) throw new ValueError('assignment_group_id not found')
      const now = w.now()
      const cur = conn.execute('UPDATE customer_case SET assignment_group_id = ?, sys_updated_on = ? WHERE case_id = ?', [
        p.assignment_group_id,
        now,
        p.case_id,
      ])
      if (cur.rowcount === 0) throw new ValueError('case_id not found')
      conn.commit()
      return { status: 'success', assignment_group_id: p.assignment_group_id, set_at: now }
    },
  ),

  get_cases_assigned_to: route(
    'get_cases_assigned_to',
    { database_id: { type: 'str', required: true }, assignment_group_id: OPT_INT, assigned_to: OPT_INT },
    (w, { value: p }) => {
      const conn = w.conn()
      const { clauses, params } = filtered(p, { assignment_group_id: ['assignment_group_id = ?'], assigned_to: ['assigned_to = ?'] })
      return all(
        conn,
        `SELECT case_id, number, account_id, contact_id, product_id, installed_product_id,
                           channel, priority, state, short_description,
                           assignment_group_id, assigned_to, sys_created_on
                    FROM customer_case${where(clauses)}
                    ORDER BY case_id`,
        params,
      )
    },
  ),

  get_average_case_reopen_count: route(
    'get_average_case_reopen_count',
    { database_id: { type: 'str', required: true }, channel: CHANNEL, priority: PRIORITY, state: STATE },
    (w, { value: f }) => {
      const conn = w.conn()
      const clauses: string[] = []
      const params: unknown[] = []
      for (const k of ['channel', 'priority', 'state']) {
        if (f[k]) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      const row = conn.execute(`SELECT AVG(reopen_count) AS avg_reopen_count FROM customer_case${where(clauses)}`, params).fetchone()!
      return { avg_reopen_count: avgOr0(row.avg_reopen_count) }
    },
  ),

  get_count_of_cases_priority_wise: route(
    'get_count_of_cases_priority_wise',
    { database_id: { type: 'str', required: true }, priority: PRIORITY },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.priority) {
        const row = conn.execute('SELECT COUNT(*) AS count FROM customer_case WHERE priority = ?', [p.priority]).fetchone()
        return { [p.priority as string]: row ? row.count : 0 }
      }
      return countsBy(all(conn, 'SELECT priority, COUNT(*) AS count FROM customer_case GROUP BY priority ORDER BY priority'), 'priority')
    },
  ),

  count_case_for_assignment_group: route(
    'count_case_for_assignment_group',
    {
      database_id: { type: 'str', required: true },
      assignment_group_id: { type: 'int', required: true },
      state: STATE,
      priority: PRIORITY,
      channel: CHANNEL,
      account_id: OPT_INT,
      product_id: OPT_INT,
    },
    (w, { value: f }) => {
      const conn = w.conn()
      const clauses = ['assignment_group_id = ?']
      const params: unknown[] = [f.assignment_group_id]
      for (const k of ['state', 'priority', 'channel']) {
        if (f[k]) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      for (const k of ['account_id', 'product_id']) {
        if (f[k] !== null) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      const row = conn.execute(`SELECT COUNT(*) AS count FROM customer_case${where(clauses)}`, params).fetchone()
      return { assignment_group_id: f.assignment_group_id, count: row ? row.count : 0 }
    },
  ),

  count_case_by_state: route(
    'count_case_by_state',
    {
      database_id: { type: 'str', required: true },
      account_id: OPT_INT,
      product_id: OPT_INT,
      assignment_group_id: OPT_INT,
      assigned_to: OPT_INT,
      priority: PRIORITY,
      channel: CHANNEL,
    },
    (w, { value: f }) => {
      const conn = w.conn()
      const clauses: string[] = []
      const params: unknown[] = []
      for (const k of ['account_id', 'product_id', 'assignment_group_id', 'assigned_to']) {
        if (f[k] !== null) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      for (const k of ['priority', 'channel']) {
        if (f[k]) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      return all(conn, `SELECT state, COUNT(*) AS count FROM customer_case${where(clauses)} GROUP BY state ORDER BY state`, params)
    },
  ),

  avg_reopen_count_for_assignment_group: route(
    'avg_reopen_count_for_assignment_group',
    { database_id: { type: 'str', required: true }, assignment_group_id: { type: 'int', required: true }, state: STATE, priority: PRIORITY, channel: CHANNEL },
    (w, { value: f }) => {
      const conn = w.conn()
      const clauses = ['assignment_group_id = ?']
      const params: unknown[] = [f.assignment_group_id]
      for (const k of ['state', 'priority', 'channel']) {
        if (f[k]) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      const row = conn.execute(`SELECT AVG(reopen_count) AS avg_reopen_count FROM customer_case${where(clauses)}`, params).fetchone()!
      return { assignment_group_id: f.assignment_group_id, avg_reopen_count: avgOr0(row.avg_reopen_count) }
    },
  ),

  search_cases: route(
    'search_cases',
    {
      database_id: { type: 'str', required: true },
      case_id: OPT_INT,
      number: OPT_STR,
      account_id: OPT_INT,
      contact_id: OPT_INT,
      product_id: OPT_INT,
      installed_product_id: OPT_INT,
      channel: CHANNEL,
      priority: PRIORITY,
      state: STATE,
      short_description: OPT_STR,
      escalation: OPT_BOOL,
      escalation_reason: opt({ enum: ESC_REASON }),
      reopen_count: OPT_INT,
      closed_on: OPT_STR,
      created_before: OPT_STR,
      created_after: OPT_STR,
    },
    (w, { value: f }) => {
      const conn = w.conn()
      const like = (v: unknown) => `%${v}%`
      const { clauses, params } = filtered(f, {
        case_id: ['case_id = ?'],
        number: ['number LIKE ?', like],
        account_id: ['account_id = ?'],
        contact_id: ['contact_id = ?'],
        product_id: ['product_id = ?'],
        installed_product_id: ['installed_product_id = ?'],
        channel: ['channel = ?'],
        priority: ['priority = ?'],
        state: ['state = ?'],
        short_description: ['short_description LIKE ?', like],
        escalation: ['escalation = ?', flag],
        escalation_reason: ['escalation_reason = ?'],
        reopen_count: ['reopen_count = ?'],
        closed_on: ['closed_on = ?'],
        created_before: ['sys_created_on <= ?'],
        created_after: ['sys_created_on >= ?'],
      })
      return all(
        conn,
        `SELECT case_id, number, account_id, contact_id, product_id, installed_product_id,
                           channel, priority, state, short_description, escalation, escalation_reason,
                           reopen_count, sys_created_on, sys_updated_on, closed_on,
                           assignment_group_id, assigned_to
                    FROM customer_case${where(clauses)}
                    ORDER BY case_id`,
        params,
      )
    },
  ),

  find_case_slas: patterned(
    'find_case_slas',
    FIND_CASE_SLAS,
    { stage: SLA_STAGE_PATTERN },
    route('find_case_slas', FIND_CASE_SLAS, (w, { value: f }) => {
      const conn = w.conn()
      const { clauses, params } = filtered(f, SLA_FILTERS)
      return all(
        conn,
        `SELECT case_sla_id, case_id, sla_def_id, stage, start_time,
                           breach_time, has_breached, completed_time
                    FROM case_sla${where(clauses)}
                    ORDER BY case_sla_id`,
        params,
      )
    }),
  ),

  find_stage_wise_breached_case_sla_counts: patterned(
    'find_stage_wise_breached_case_sla_counts',
    FIND_STAGE,
    { stage: SLA_STAGE_PATTERN },
    route('find_stage_wise_breached_case_sla_counts', FIND_STAGE, (w, { value: p }) => {
      const conn = w.conn()
      if (p.stage) {
        const row = conn.execute('SELECT COUNT(*) AS count FROM case_sla WHERE has_breached = 1 AND stage = ?', [p.stage]).fetchone()
        return { [p.stage as string]: row ? row.count : 0 }
      }
      return countsBy(all(conn, 'SELECT stage, COUNT(*) AS count FROM case_sla WHERE has_breached = 1 GROUP BY stage ORDER BY stage'), 'stage')
    }),
  ),

  find_interactions: patterned(
    'find_interactions',
    FIND_INTERACTIONS,
    { status: INTERACTION_STATUS_PATTERN },
    route('find_interactions', FIND_INTERACTIONS, (w, { value: f }) => {
      const conn = w.conn()
      const { clauses, params } = filtered(f, {
        interaction_id: ['interaction_id = ?'],
        channel: ['channel = ?'],
        account_id: ['account_id = ?'],
        contact_id: ['contact_id = ?'],
        case_id: ['case_id = ?'],
        interacted_user: ['interacted_user = ?'],
        status: ['status = ?'],
        started_at: ['started_at = ?'],
        ended_at: ['ended_at = ?'],
        created_before: ['sys_created_on <= ?'],
        created_after: ['sys_created_on >= ?'],
        started_at_before: ['started_at <= ?'],
        started_at_after: ['started_at >= ?'],
        ended_at_before: ['ended_at <= ?'],
        ended_at_after: ['ended_at >= ?'],
      })
      return all(
        conn,
        `SELECT interaction_id, channel, account_id, contact_id, case_id,
                           interacted_user, status, started_at, ended_at, sys_created_on
                    FROM interaction${where(clauses)}
                    ORDER BY interaction_id`,
        params,
      )
    }),
  ),

  count_interaction_by_status: route(
    'count_interaction_by_status',
    { database_id: { type: 'str', required: true }, account_id: OPT_INT, contact_id: OPT_INT, case_id: OPT_INT, channel: CHANNEL },
    (w, { value: f }) => {
      const conn = w.conn()
      const clauses: string[] = []
      const params: unknown[] = []
      for (const k of ['account_id', 'contact_id', 'case_id']) {
        if (f[k] !== null) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      if (f.channel) {
        clauses.push('channel = ?')
        params.push(f.channel)
      }
      return all(conn, `SELECT status, COUNT(*) AS count FROM interaction${where(clauses)} GROUP BY status ORDER BY status`, params)
    },
  ),

  avg_interactions_per_case_by_status: route(
    'avg_interactions_per_case_by_status',
    { database_id: { type: 'str', required: true }, account_id: OPT_INT, contact_id: OPT_INT, channel: CHANNEL },
    (w, { value: f }) => {
      const conn = w.conn()
      const clauses: string[] = []
      const params: unknown[] = []
      for (const k of ['account_id', 'contact_id']) {
        if (f[k] !== null) {
          clauses.push(`${k} = ?`)
          params.push(f[k])
        }
      }
      if (f.channel) {
        clauses.push('channel = ?')
        params.push(f.channel)
      }
      return all(
        conn,
        `
                WITH per_case AS (
                  SELECT status, case_id, COUNT(*) AS cnt
                  FROM interaction
                  ${where(clauses)}
                  GROUP BY status, case_id
                )
                SELECT status, AVG(cnt) AS avg_interactions_per_case
                FROM per_case
                GROUP BY status
                ORDER BY status
            `,
        params,
      )
    },
  ),

  get_channel_wise_case_count: route(
    'get_channel_wise_case_count',
    { database_id: { type: 'str', required: true }, channel: CHANNEL },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.channel) {
        const row = conn.execute('SELECT COUNT(*) AS count FROM customer_case WHERE channel = ?', [p.channel]).fetchone()
        return { [p.channel as string]: row ? row.count : 0 }
      }
      return countsBy(all(conn, 'SELECT channel, COUNT(*) AS count FROM customer_case GROUP BY channel ORDER BY channel'), 'channel')
    },
  ),

  create_new_case: route(
    'create_new_case',
    {
      database_id: { type: 'str', required: true },
      account_id: { type: 'int', required: true },
      contact_id: { type: 'int', required: true },
      product_id: OPT_INT,
      installed_product_id: OPT_INT,
      channel: { type: { enum: CASE_CHANNEL }, required: true },
      priority: { type: { enum: CASE_PRIORITY }, required: true },
      state: { type: { enum: CASE_STATE }, required: true },
      short_description: { type: 'str', required: true, minLength: 1, maxLength: 500 },
      escalation: { type: 'bool', nullable: true, default: false },
      escalation_reason: opt({ enum: ESC_REASON }),
      reopen_count: { type: 'int', nullable: true, default: 0 },
      closed_on: OPT_STR,
      assignment_group_id: OPT_INT,
      assigned_to: OPT_INT,
    },
    (w, { value: p }) => {
      const conn = w.conn()
      const c = conn.execute('SELECT account_id FROM contact WHERE contact_id = ?', [p.contact_id]).fetchone()
      if (!c) throw new ValueError('Invalid contact_id')
      if (!same(c.account_id!, p.account_id)) throw new ValueError('contact_id does not belong to the provided account_id')
      if (p.product_id !== null && !exists(conn, 'SELECT 1 FROM product WHERE product_id = ?', p.product_id)) throw new ValueError('Invalid product_id')
      if (p.installed_product_id !== null) {
        const ip = conn.execute('SELECT account_id FROM installed_product WHERE installed_product_id = ?', [p.installed_product_id]).fetchone()
        if (!ip) throw new ValueError('Invalid installed_product_id')
        if (!same(ip.account_id!, p.account_id)) throw new ValueError('installed_product_id does not belong to the provided account_id')
      }
      if (p.assignment_group_id !== null && !exists(conn, 'SELECT 1 FROM user_group WHERE group_id = ?', p.assignment_group_id)) {
        throw new ValueError('Invalid assignment_group_id')
      }
      if (p.assigned_to !== null) {
        const r = role(conn, p.assigned_to, true)
        if (r === undefined) throw new ValueError('Invalid assigned_to user')
        if (!INTERNAL.includes(r as string)) throw new ValueError('assigned_to must be an internal user')
      }
      // _get_case_number
      const nxt = conn.execute('SELECT COALESCE(MAX(case_id),0) + 1 FROM customer_case').fetchone()!
      const number = `CS-${String(Object.values(nxt)[0]).padStart(7, '0')}`
      const now = w.now()
      const cur = conn.execute(
        `
                INSERT INTO customer_case (
                    number, account_id, contact_id, product_id, installed_product_id,
                    channel, priority, state, short_description, assignment_group_id,
                    assigned_to, escalation, escalation_reason, reopen_count,
                    sys_created_on, sys_updated_on, closed_on
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
        [
          number,
          p.account_id,
          p.contact_id,
          p.product_id,
          p.installed_product_id,
          p.channel,
          p.priority,
          p.state,
          p.short_description,
          p.assignment_group_id,
          p.assigned_to,
          flag(p.escalation),
          p.escalation_reason,
          p.reopen_count || 0,
          now,
          now,
          p.closed_on,
        ],
      )
      conn.commit()
      return selectOne(conn, 'customer_case', 'case_id', cur.lastrowid)
    },
  ),

  update_case: route(
    'update_case',
    {
      database_id: { type: 'str', required: true },
      case_id: { type: 'int', required: true },
      account_id: OPT_INT,
      contact_id: OPT_INT,
      product_id: OPT_INT,
      installed_product_id: OPT_INT,
      channel: CHANNEL,
      priority: PRIORITY,
      state: STATE,
      short_description: { type: 'str', nullable: true, minLength: 1 },
      escalation: OPT_BOOL,
      escalation_reason: opt({ enum: ESC_REASON }),
      reopen_count: OPT_INT,
      closed_on: OPT_STR,
      assignment_group_id: OPT_INT,
      assigned_to: OPT_INT,
    },
    (w, { value }) => {
      const u = updatesOf(value, 'case_id')
      const conn = w.conn()
      const sets: string[] = []
      const params: unknown[] = []
      const put = (k: string, v: unknown) => {
        sets.push(`${k} = ?`)
        params.push(v)
      }
      if (given(u, 'account_id')) {
        if (!exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', u.account_id)) throw new ValueError('Invalid account_id')
        put('account_id', u.account_id)
      }
      if (given(u, 'contact_id')) {
        const row = conn.execute('SELECT account_id FROM contact WHERE contact_id = ?', [u.contact_id]).fetchone()
        if (!row) throw new ValueError('Invalid contact_id')
        if (given(u, 'account_id') && !same(row.account_id!, u.account_id)) throw new ValueError('contact_id does not belong to provided account_id')
        put('contact_id', u.contact_id)
      }
      if (given(u, 'product_id')) {
        if (!exists(conn, 'SELECT 1 FROM product WHERE product_id = ?', u.product_id)) throw new ValueError('Invalid product_id')
        put('product_id', u.product_id)
      }
      if (given(u, 'installed_product_id')) {
        const ip = conn.execute('SELECT account_id FROM installed_product WHERE installed_product_id = ?', [u.installed_product_id]).fetchone()
        if (!ip) throw new ValueError('Invalid installed_product_id')
        if (given(u, 'account_id') && !same(ip.account_id!, u.account_id)) {
          throw new ValueError('installed_product_id does not belong to provided account_id')
        }
        put('installed_product_id', u.installed_product_id)
      }
      if (given(u, 'assignment_group_id')) {
        if (!exists(conn, 'SELECT 1 FROM user_group WHERE group_id = ?', u.assignment_group_id)) throw new ValueError('Invalid assignment_group_id')
        put('assignment_group_id', u.assignment_group_id)
      }
      if (given(u, 'assigned_to')) {
        const r = role(conn, u.assigned_to, true)
        if (r === undefined) throw new ValueError('Invalid assigned_to')
        if (!INTERNAL.includes(r as string)) throw new ValueError('assigned_to must be an internal user')
        put('assigned_to', u.assigned_to)
      }
      for (const k of ['channel', 'priority', 'state', 'short_description', 'escalation_reason', 'closed_on']) if (given(u, k)) put(k, u[k])
      if (given(u, 'escalation')) put('escalation', flag(u.escalation))
      if (given(u, 'reopen_count')) put('reopen_count', u.reopen_count)
      if (sets.length === 0) throw new ValueError('No fields to update')
      put('sys_updated_on', w.now())
      return update(conn, 'customer_case', 'case_id', value.case_id, sets, params)
    },
  ),

  link_new_case_sla: route(
    'link_new_case_sla',
    {
      database_id: { type: 'str', required: true },
      case_id: { type: 'int', required: true },
      sla_def_id: { type: 'int', required: true },
      stage: { type: { enum: SLA_STAGE }, required: true },
      start_time: OPT_STR,
      breach_time: OPT_STR,
      has_breached: { type: 'bool', nullable: true, default: false },
      completed_time: OPT_STR,
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (!exists(conn, 'SELECT 1 FROM customer_case WHERE case_id = ?', p.case_id)) throw new ValueError('Invalid case_id')
      if (!exists(conn, 'SELECT 1 FROM sla_definition WHERE sla_def_id = ?', p.sla_def_id)) throw new ValueError('Invalid sla_def_id')
      const startTime = p.start_time || w.now()
      const cur = conn.execute(
        `INSERT INTO case_sla(case_id, sla_def_id, stage, start_time, breach_time, has_breached, completed_time)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.case_id, p.sla_def_id, p.stage, startTime, p.breach_time, flag(p.has_breached), p.completed_time],
      )
      conn.commit()
      return selectOne(conn, 'case_sla', 'case_sla_id', cur.lastrowid)
    },
  ),

  update_case_sla_details: route(
    'update_case_sla_details',
    {
      database_id: { type: 'str', required: true },
      case_sla_id: { type: 'int', required: true },
      case_id: OPT_INT,
      sla_def_id: OPT_INT,
      stage: opt({ enum: SLA_STAGE }),
      start_time: OPT_STR,
      breach_time: OPT_STR,
      has_breached: OPT_BOOL,
      completed_time: OPT_STR,
    },
    (w, { value }) => {
      const u = updatesOf(value, 'case_sla_id')
      const conn = w.conn()
      const sets: string[] = []
      const params: unknown[] = []
      const put = (k: string, v: unknown) => {
        sets.push(`${k} = ?`)
        params.push(v)
      }
      if (given(u, 'case_id')) {
        if (!exists(conn, 'SELECT 1 FROM customer_case WHERE case_id = ?', u.case_id)) throw new ValueError('Invalid case_id')
        put('case_id', u.case_id)
      }
      if (given(u, 'sla_def_id')) {
        if (!exists(conn, 'SELECT 1 FROM sla_definition WHERE sla_def_id = ?', u.sla_def_id)) throw new ValueError('Invalid sla_def_id')
        put('sla_def_id', u.sla_def_id)
      }
      for (const k of ['stage', 'start_time', 'breach_time', 'completed_time']) if (given(u, k)) put(k, u[k])
      if (given(u, 'has_breached')) put('has_breached', flag(u.has_breached))
      return update(conn, 'case_sla', 'case_sla_id', value.case_sla_id, sets, params)
    },
  ),

  delete_case_slas: route(
    'delete_case_slas',
    {
      database_id: { type: 'str', required: true },
      case_sla_id: OPT_INT,
      case_id: OPT_INT,
      sla_def_id: OPT_INT,
      stage: opt({ enum: SLA_STAGE }),
      start_time: OPT_STR,
      breach_time: OPT_STR,
      has_breached: OPT_BOOL,
      completed_time: OPT_STR,
    },
    (w, { value: f }) => {
      const conn = w.conn()
      const { clauses, params } = filtered(f, SLA_FILTERS)
      if (clauses.length === 0) throw new ValueError('Refuse to delete without any filter')
      const cur = conn.execute(`DELETE FROM case_sla${where(clauses)}`, params)
      conn.commit()
      return { deleted: cur.rowcount }
    },
  ),

  register_new_interaction: route(
    'register_new_interaction',
    {
      database_id: { type: 'str', required: true },
      channel: { type: { enum: CASE_CHANNEL }, required: true },
      account_id: OPT_INT,
      contact_id: OPT_INT,
      case_id: OPT_INT,
      interacted_user: OPT_INT,
      status: { type: { enum: INTERACTION_STATUS }, required: true },
      started_at: OPT_STR,
      ended_at: OPT_STR,
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.account_id !== null && !exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', p.account_id)) throw new ValueError('Invalid account_id')
      if (p.contact_id !== null && !exists(conn, 'SELECT 1 FROM contact WHERE contact_id = ?', p.contact_id)) throw new ValueError('Invalid contact_id')
      if (p.case_id !== null && !exists(conn, 'SELECT 1 FROM customer_case WHERE case_id = ?', p.case_id)) throw new ValueError('Invalid case_id')
      if (p.interacted_user !== null && !exists(conn, 'SELECT 1 FROM "user" WHERE user_id = ?', p.interacted_user)) {
        throw new ValueError('Invalid interacted_user')
      }
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO interaction(
                    channel, account_id, contact_id, case_id, interacted_user,
                    status, started_at, ended_at, sys_created_on
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.channel, p.account_id, p.contact_id, p.case_id, p.interacted_user, p.status, p.started_at || now, p.ended_at, now],
      )
      conn.commit()
      return selectOne(conn, 'interaction', 'interaction_id', cur.lastrowid)
    },
  ),

  update_interaction: route(
    'update_interaction',
    {
      database_id: { type: 'str', required: true },
      interaction_id: { type: 'int', required: true },
      channel: CHANNEL,
      account_id: OPT_INT,
      contact_id: OPT_INT,
      case_id: OPT_INT,
      interacted_user: OPT_INT,
      status: opt({ enum: INTERACTION_STATUS }),
      started_at: OPT_STR,
      ended_at: OPT_STR,
    },
    (w, { value }) => {
      const u = updatesOf(value, 'interaction_id')
      const conn = w.conn()
      const sets: string[] = []
      const params: unknown[] = []
      const put = (k: string, v: unknown) => {
        sets.push(`${k} = ?`)
        params.push(v)
      }
      const checks: [string, string, string][] = [
        ['account_id', 'SELECT 1 FROM account WHERE account_id = ?', 'Invalid account_id'],
        ['contact_id', 'SELECT 1 FROM contact WHERE contact_id = ?', 'Invalid contact_id'],
        ['case_id', 'SELECT 1 FROM customer_case WHERE case_id = ?', 'Invalid case_id'],
        ['interacted_user', 'SELECT 1 FROM "user" WHERE user_id = ?', 'Invalid interacted_user'],
      ]
      for (const [k, sql, msg] of checks) {
        if (!given(u, k)) continue
        if (!exists(conn, sql, u[k])) throw new ValueError(msg)
        put(k, u[k])
      }
      for (const k of ['channel', 'status', 'started_at', 'ended_at']) if (given(u, k)) put(k, u[k])
      if (u.status === 'closed' && !('ended_at' in u)) put('ended_at', w.now())
      return update(conn, 'interaction', 'interaction_id', value.interaction_id, sets, params)
    },
  ),
}
