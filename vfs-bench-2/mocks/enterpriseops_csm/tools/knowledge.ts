/**
 * CSM's knowledge tools: ports of `CSMManager`'s methods and their routes
 * (sn-csm-server's database/csm_manager.py and apis/csm_apis.py, read from
 * the image's bytecode).
 */
import { ValueError } from '../../enterpriseops/errors.ts'
import type { Tool } from '../../enterpriseops/fake.ts'
import type { Model } from '../../enterpriseops/model.ts'
import { PyFloat } from '../../enterpriseops/py.ts'
import { type Conn, type Row, at } from '../../enterpriseops/sqlite.ts'
import { route } from '../api.ts'

const KB_STATE = ['draft', 'published', 'retired'] as const
const KB_VISIBILITY = ['internal', 'external'] as const
const USED_AS = ['suggested', 'applied', 'resolution'] as const
const NOTIFICATION_TYPE = ['report', 'update', 'alert', 'reminder', 'solution_proposal', 'next_steps', 'other'] as const
const NOTIFICATION_STATUS = ['success', 'failed'] as const

const optInt = { type: 'int', nullable: true } as const
const optStr = { type: 'str', nullable: true } as const
const optEnum = (values: readonly string[]) => ({ type: { enum: values }, nullable: true }) as const

/** The `clauses`/`params` a filter mapping builds: each given (non-None) filter's SQL, its value converted. */
function where(filters: Record<string, unknown>, mapping: Record<string, string | [string, (v: unknown) => unknown]>) {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const [k, spec] of Object.entries(mapping)) {
    const v = filters[k]
    if (v === null || v === undefined) continue
    const [sql, conv] = typeof spec === 'string' ? [spec, (x: unknown) => x] : spec
    clauses.push(sql)
    params.push(conv(v))
  }
  return { clauses, params }
}

const like = (v: unknown) => `%${v}%`

/** `if not cur.execute(sql, (id,)).fetchone(): raise ValueError(error)`. */
function exists(conn: Conn, sql: string, id: unknown, error: string): void {
  if (!conn.execute(sql, [id]).fetchone()) throw new ValueError(error)
}

/** `CSMManager.retrieve_knowledge.norm_expr`: a column lowercased, punctuation to spaces, space-padded. */
function normExpr(col: string): string {
  let e = `coalesce(lower(${col}), '')`
  e = `(' ' || trim(replace(replace(replace(replace(replace(replace(replace(replace(${e}, '-', ' '), '/', ' '), ',', ' '), '.', ' '), '(', ' '), ')', ' '), char(10), ' '), char(9), ' ')) || ' ')`
  return `replace(replace(replace(${e}, '  ', ' '), '  ', ' '), '  ', ' ')`
}

function retrieveKnowledge(conn: Conn, filters: Record<string, unknown>): Row[] {
  const { clauses, params } = where(filters, {
    knowledge_id: 'k.knowledge_id = ?',
    kb_number: 'k.kb_number = ?',
    title: ['k.title LIKE ?', like],
    state: 'k.state = ?',
    visibility: 'k.visibility = ?',
    product_id: 'k.product_id = ?',
    owner_id: 'k.owner_id = ?',
    created_before: 'k.sys_created_on <= ?',
    created_after: 'k.sys_created_on >= ?',
  })
  // `int(filters.get('limit', 10))`: the model always gives `limit`, so None fails here.
  const limit = filters.limit
  if (limit === null || limit === undefined) {
    throw new Error("int() argument must be a string, a bytes-like object or a real number, not 'NoneType'")
  }
  const searchText = ((filters.search_text as string | null) || '').trim()
  if (!searchText) {
    const whereSql = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : ''
    return conn
      .execute(
        `SELECT
                            k.knowledge_id, k.kb_number, k.title, k.state, k.visibility,
                            k.product_id, k.owner_id, k.sys_created_on, k.body  -- include body always
                        FROM knowledge k
                        ${whereSql}
                        ORDER BY k.knowledge_id
                        LIMIT ?`,
        [...params, limit],
      )
      .fetchall()
  }

  const titleLc = "coalesce(lower(k.title), '')"
  const bodyLc = "coalesce(lower(k.body),  '')"
  const normTitle = normExpr('k.title')
  const normBody = normExpr('k.body')
  const phraseLc = searchText.toLowerCase().trim()
  // Python's `\w` / `\d` are Unicode-aware.
  const qNorm = phraseLc.replace(/[^\p{L}\p{N}_]+/gu, ' ').trim()
  const qTokens = qNorm.split(' ').filter((t) => t)
  const numbers = phraseLc.match(/\p{Nd}+/gu) ?? []
  const terms = qTokens.filter((t) => !/^\p{Nd}+$/u.test(t))

  const scoreTerms: string[] = []
  const scoreParams: unknown[] = []
  for (const t of terms) {
    const occTitle = `(length(${titleLc}) - length(replace(${titleLc}, ?, ''))) / nullif(length(?), 0)`
    const occBody = `(length(${bodyLc}) - length(replace(${bodyLc},  ?, ''))) / nullif(length(?), 0)`
    scoreTerms.push(`(5.0*${occTitle} + 1.0*${occBody})`)
    scoreParams.push(t, t, t, t)
  }
  for (const n of numbers) {
    const likeTok = `% ${n} %`
    scoreTerms.push(`(CASE WHEN ${normTitle} LIKE ? THEN 6.0 ELSE 0 END)`)
    scoreParams.push(likeTok)
    scoreTerms.push(`(CASE WHEN ${normBody} LIKE ? THEN 3.0 ELSE 0 END)`)
    scoreParams.push(likeTok)
  }
  const addNgram = (ngram: string, wTitle = '15.0', wBody = '4.0') => {
    if (!ngram.trim()) return
    const l = `% ${ngram.trim()} %`
    scoreTerms.push(`(CASE WHEN ${normTitle} LIKE ? THEN ${wTitle} ELSE 0 END)`)
    scoreTerms.push(`(CASE WHEN ${normBody} LIKE ? THEN ${wBody} ELSE 0 END)`)
    scoreParams.push(l, l)
  }
  for (let i = 0; i < qTokens.length; i++) {
    if (i + 1 < qTokens.length) addNgram(qTokens.slice(i, i + 2).join(' '))
    if (i + 2 < qTokens.length) addNgram(qTokens.slice(i, i + 3).join(' '), '20.0', '5.0')
  }
  if (qNorm) {
    const fullLike = `% ${qNorm} %`
    scoreTerms.push(`(CASE WHEN ${normTitle} LIKE ? THEN 60.0 ELSE 0 END)`)
    scoreTerms.push(`(CASE WHEN ${normBody}  LIKE ? THEN 12.0 ELSE 0 END)`)
    scoreParams.push(fullLike, fullLike)
  }
  if (phraseLc) {
    scoreTerms.push(`(CASE WHEN ${bodyLc}  LIKE ? THEN 25.0 ELSE 0 END)`)
    scoreTerms.push(`(CASE WHEN ${titleLc} LIKE ? THEN  8.0 ELSE 0 END)`)
    scoreParams.push(`%${phraseLc}%`, `%${phraseLc}%`)
  }
  scoreTerms.push("(CASE WHEN k.state = 'published' THEN 0.5 ELSE 0 END)")
  const scoreExpr = scoreTerms.length > 0 ? scoreTerms.join(' + ') : '0'
  const whereSql = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : ''
  const sql = `
                SELECT *
                FROM (
                    SELECT
                        k.knowledge_id, k.kb_number, k.title, k.state, k.visibility,
                        k.product_id, k.owner_id, k.sys_created_on, k.body,
                        (${scoreExpr}) AS score
                    FROM knowledge k
                    ${whereSql}
                ) AS s
                WHERE s.score > 0
                ORDER BY s.score DESC, s.sys_created_on DESC
                LIMIT ?
            `
  return conn.execute(sql, [...scoreParams, ...params, limit]).fetchall()
}

/** An update's `SET` list from the given (non-None) fields; `checks` validates a field before it is set. */
function updateSql(
  conn: Conn,
  table: string,
  key: string,
  id: unknown,
  updates: Record<string, unknown>,
  fields: string[],
  checks: Record<string, (v: unknown) => void>,
  extra: [string, unknown][] = [],
): Row | null {
  const sets: string[] = []
  const params: unknown[] = []
  for (const f of fields) {
    const v = updates[f]
    if (v === null || v === undefined) continue
    checks[f]?.(v)
    sets.push(`${f} = ?`)
    params.push(v)
  }
  if (sets.length === 0) throw new ValueError('No fields to update')
  for (const [f, v] of extra) {
    sets.push(`${f} = ?`)
    params.push(v)
  }
  params.push(id)
  const cur = conn.execute(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${key} = ?`, params)
  if (cur.rowcount === 0) throw new ValueError(`${key} not found`)
  conn.commit()
  return conn.execute(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]).fetchone()
}

/** A delete by the given (non-None) filters; refuses none. */
function deleteWhere(conn: Conn, table: string, filters: Record<string, unknown>, mapping: Record<string, string>) {
  const { clauses, params } = where(filters, mapping)
  if (clauses.length === 0) throw new ValueError('Refuse to delete without any filter')
  const cur = conn.execute(`DELETE FROM ${table} WHERE ${clauses.join(' AND ')}`, params)
  const count = cur.rowcount
  conn.commit()
  return { deleted: count }
}

const caseCheck = (conn: Conn) => (v: unknown) => exists(conn, 'SELECT 1 FROM customer_case WHERE case_id = ?', v, 'Invalid case_id')
const knowledgeCheck = (conn: Conn) => (v: unknown) => exists(conn, 'SELECT 1 FROM knowledge WHERE knowledge_id = ?', v, 'Invalid knowledge_id')
const productCheck = (conn: Conn) => (v: unknown) => exists(conn, 'SELECT 1 FROM product WHERE product_id = ?', v, 'Invalid product_id')
const ownerCheck = (conn: Conn) => (v: unknown) => exists(conn, 'SELECT 1 FROM "user" WHERE user_id = ?', v, 'Invalid owner_id')

const CASE_KB_FILTERS: Model = {
  case_kb_id: optInt,
  case_id: optInt,
  knowledge_id: optInt,
  used_as: optEnum(USED_AS),
}

export const tools: Record<string, Tool> = {
  retrieve_knowledge: route(
    'retrieve_knowledge',
    {
      search_text: optStr,
      knowledge_id: optInt,
      kb_number: optStr,
      title: optStr,
      state: optEnum(KB_STATE),
      visibility: optEnum(KB_VISIBILITY),
      product_id: optInt,
      owner_id: optInt,
      created_before: optStr,
      created_after: optStr,
      limit: { type: 'int', nullable: true, default: 5 },
    },
    (w, { value }) => retrieveKnowledge(w.conn(), value),
  ),

  find_case_knowledge_linkages: route('find_case_knowledge_linkages', CASE_KB_FILTERS, (w, { value }) => {
    const { clauses, params } = where(value, { case_kb_id: 'case_kb_id = ?', case_id: 'case_id = ?', knowledge_id: 'knowledge_id = ?', used_as: 'used_as = ?' })
    const whereSql = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : ''
    return w
      .conn()
      .execute(
        `SELECT case_kb_id, case_id, knowledge_id, used_as
                    FROM case_knowledge${whereSql}
                    ORDER BY case_kb_id`,
        params,
      )
      .fetchall()
  }),

  find_notifications: route(
    'find_notifications',
    {
      notification_id: optInt,
      case_id: optInt,
      knowledge_id: optInt,
      email: optStr,
      type: optEnum(NOTIFICATION_TYPE),
      status: optEnum(NOTIFICATION_STATUS),
      sys_created_on: optStr,
    },
    (w, { value }) => {
      const { clauses, params } = where(value, {
        notification_id: 'notification_id = ?',
        case_id: 'case_id = ?',
        knowledge_id: 'knowledge_id = ?',
        email: ['email LIKE ?', like],
        type: 'type = ?',
        status: 'status = ?',
        sys_created_on: 'sys_created_on = ?',
      })
      const whereSql = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : ''
      return w
        .conn()
        .execute(
          `SELECT notification_id, case_id, knowledge_id, email, type, status, sys_created_on
                    FROM notification${whereSql}
                    ORDER BY notification_id`,
          params,
        )
        .fetchall()
    },
  ),

  count_notifications_by_status: route('count_notifications_by_status', { status: optEnum(NOTIFICATION_STATUS) }, (w, { value }) => {
    const conn = w.conn()
    const status = value.status as string | null
    if (status) {
      const row = conn.execute('SELECT COUNT(*) AS count FROM notification WHERE status = ?', [status]).fetchone()
      return { [status]: row ? row.count : 0 }
    }
    const rows = conn.execute('SELECT status, COUNT(*) AS count FROM notification GROUP BY status ORDER BY status').fetchall()
    return pyDict(rows.map((r) => [r.status, r.count]))
  }),

  count_notifications_by_case: route('count_notifications_by_case', { case_id: optInt }, (w, { value }) => {
    const conn = w.conn()
    const row =
      value.case_id !== null
        ? conn.execute('SELECT COUNT(*) AS count FROM notification WHERE case_id = ?', [value.case_id]).fetchone()
        : conn.execute('SELECT COUNT(*) AS count FROM notification').fetchone()
    return { count: row ? row.count : 0 }
  }),

  avg_notifications_by_case: route('avg_notifications_by_case', { case: optInt }, (w, { value }) => {
    const conn = w.conn()
    if (value.case !== null) {
      const row = conn.execute('SELECT COUNT(*) AS cnt FROM notification WHERE case_id = ?', [value.case]).fetchone()
      return { avg_count: new PyFloat(row ? Number(row.cnt) : 0) }
    }
    const rows = conn.execute('SELECT case_id, COUNT(*) AS cnt FROM notification GROUP BY case_id').fetchall()
    if (rows.length === 0) return { avg_count: new PyFloat(0) }
    return { avg_count: new PyFloat(rows.reduce((s, r) => s + Number(r.cnt), 0) / rows.length) }
  }),

  count_notifications_by_type: route('count_notifications_by_type', { type: { type: { list: { enum: NOTIFICATION_TYPE } }, nullable: true } }, (w, { value }) => {
    const conn = w.conn()
    const types = value.type as string[] | null
    const rows =
      types && types.length > 0
        ? conn.execute(`SELECT type, COUNT(*) AS count FROM notification WHERE type IN (${types.map(() => '?').join(',')}) GROUP BY type ORDER BY type`, types).fetchall()
        : conn.execute('SELECT type, COUNT(*) AS count FROM notification GROUP BY type ORDER BY type').fetchall()
    return pyDict(rows.map((r) => [r.type, r.count]))
  }),

  create_knowledge: route(
    'create_knowledge',
    {
      title: { type: 'str', required: true, minLength: 1, maxLength: 120 },
      body: { type: 'str', required: true, minLength: 1, maxLength: 120 },
      state: { type: { enum: KB_STATE }, required: true },
      visibility: { type: { enum: KB_VISIBILITY }, required: true },
      product_id: optInt,
      owner_id: { type: 'int', required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.product_id !== null) productCheck(conn)(p.product_id)
      ownerCheck(conn)(p.owner_id)
      // `_get_kb_number`: the next knowledge_id, not the next free number.
      const nxt = Number(at(conn.execute('SELECT COALESCE(MAX(knowledge_id),0) + 1 FROM knowledge').fetchone()!, 0))
      const kbNumber = `KB${String(nxt).padStart(6, '0')}`
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO knowledge(kb_number,title,body,state,visibility,product_id,owner_id,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?,?,?,?)`,
        [kbNumber, p.title, p.body, p.state, p.visibility, p.product_id, p.owner_id, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM knowledge WHERE knowledge_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_knowledge: route(
    'update_knowledge',
    {
      knowledge_id: { type: 'int', required: true },
      kb_number: optStr,
      title: { type: 'str', nullable: true, minLength: 1 },
      state: optEnum(KB_STATE),
      visibility: optEnum(KB_VISIBILITY),
      product_id: optInt,
      owner_id: optInt,
    },
    (w, { value: p }) => {
      const conn = w.conn()
      return updateSql(conn, 'knowledge', 'knowledge_id', p.knowledge_id, p, ['kb_number', 'product_id', 'owner_id', 'title', 'state', 'visibility'], {
        kb_number: (v) => {
          if (conn.execute('SELECT 1 FROM knowledge WHERE kb_number = ? AND knowledge_id <> ?', [v, p.knowledge_id]).fetchone()) {
            throw new ValueError('kb_number already exists')
          }
        },
        product_id: productCheck(conn),
        owner_id: ownerCheck(conn),
      }, [['sys_updated_on', w.now()]])
    },
  ),

  link_case_knowledge: route(
    'link_case_knowledge',
    {
      case_id: { type: 'int', required: true },
      knowledge_id: { type: 'int', required: true },
      used_as: { type: { enum: USED_AS }, required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      caseCheck(conn)(p.case_id)
      knowledgeCheck(conn)(p.knowledge_id)
      const cur = conn.execute('INSERT INTO case_knowledge(case_id,knowledge_id,used_as) VALUES(?,?,?)', [p.case_id, p.knowledge_id, p.used_as])
      conn.commit()
      return conn.execute('SELECT * FROM case_knowledge WHERE case_kb_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  updated_linked_case_knowledge: route(
    'updated_linked_case_knowledge',
    { case_kb_id: { type: 'int', required: true }, case_id: optInt, knowledge_id: optInt, used_as: optEnum(USED_AS) },
    (w, { value: p }) => {
      const conn = w.conn()
      return updateSql(conn, 'case_knowledge', 'case_kb_id', p.case_kb_id, p, ['case_id', 'knowledge_id', 'used_as'], {
        case_id: caseCheck(conn),
        knowledge_id: knowledgeCheck(conn),
      })
    },
  ),

  delete_case_knowledge_linkages: route('delete_case_knowledge_linkages', CASE_KB_FILTERS, (w, { value }) =>
    deleteWhere(w.conn(), 'case_knowledge', value, { case_kb_id: 'case_kb_id = ?', case_id: 'case_id = ?', knowledge_id: 'knowledge_id = ?', used_as: 'used_as = ?' }),
  ),

  send_notification: route(
    'send_notification',
    {
      case_id: { type: 'int', required: true },
      knowledge_id: optInt,
      email: { type: 'str', required: true, minLength: 1 },
      type: { type: { enum: NOTIFICATION_TYPE }, required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      caseCheck(conn)(p.case_id)
      if (p.knowledge_id !== null) knowledgeCheck(conn)(p.knowledge_id)
      const cur = conn.execute(
        `INSERT INTO notification(case_id, knowledge_id, email, type, status, sys_created_on)
                VALUES(?,?,?,?,?,?)`,
        [p.case_id, p.knowledge_id, p.email, p.type, 'success', w.now()],
      )
      conn.commit()
      return conn.execute('SELECT * FROM notification WHERE notification_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_notification: route(
    'update_notification',
    {
      notification_id: { type: 'int', required: true },
      case_id: optInt,
      knowledge_id: optInt,
      email: { type: 'str', nullable: true, minLength: 1 },
      type: optEnum(NOTIFICATION_TYPE),
      status: optEnum(NOTIFICATION_STATUS),
    },
    (w, { value: p }) => {
      const conn = w.conn()
      return updateSql(conn, 'notification', 'notification_id', p.notification_id, p, ['case_id', 'knowledge_id', 'email', 'type', 'status', 'sys_created_on'], {
        case_id: caseCheck(conn),
        knowledge_id: knowledgeCheck(conn),
      })
    },
  ),

  delete_notifications: route(
    'delete_notifications',
    {
      notification_id: optInt,
      case_id: optInt,
      knowledge_id: optInt,
      email: { type: 'str', nullable: true, minLength: 1 },
      type: optEnum(NOTIFICATION_TYPE),
      status: optEnum(NOTIFICATION_STATUS),
      sys_created_on: optStr,
      created_before: optStr,
      created_after: optStr,
    },
    (w, { value }) =>
      deleteWhere(w.conn(), 'notification', value, {
        notification_id: 'notification_id = ?',
        case_id: 'case_id = ?',
        knowledge_id: 'knowledge_id = ?',
        email: 'email = ?',
        type: 'type = ?',
        status: 'status = ?',
        sys_created_on: 'sys_created_on = ?',
        created_before: 'sys_created_on <= ?',
        created_after: 'sys_created_on >= ?',
      }),
  ),
}

/** A Python dict built from `(key, value)` pairs: later keys overwrite, first insertion keeps its place. */
function pyDict(pairs: [unknown, unknown][]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of pairs) out[String(k)] = v
  return out
}
