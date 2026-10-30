/**
 * CSM's installed product, contract, entitlement and SLA definition tools:
 * ports of `CSMManager`'s methods and their routes (sn-csm-server's
 * database/csm_manager.py and apis/csm_apis.py, read from the image's
 * bytecode).
 */
import { ValueError } from '../../enterpriseops/errors.ts'
import type { Tool } from '../../enterpriseops/fake.ts'
import type { Field, Model } from '../../enterpriseops/model.ts'
import type { Conn } from '../../enterpriseops/sqlite.ts'
import { type Body, route } from '../api.ts'
import { CONTRACT_STATUS, CONTRACT_TYPE, COVERAGE_HOURS, PRIORITY, SLA_METRIC, SUPPORT_LEVEL } from './models.ts'

const INSTALLED_STATUS = ['in_use', 'in_stock', 'repair', 'retired'] as const

/** `Optional[T] = None`. */
const opt = (type: Field['type'], extra: Partial<Field> = {}): Field => ({ type, nullable: true, ...extra })
const OPT_INT = opt('int')
const OPT_STR = opt('str')
const OPT_BOOL = opt('bool')

const one = (v: unknown) => (v ? 1 : 0)
const like = (v: unknown) => `%${v}%`

/** `WHERE` of the `clauses` (or '' with none). */
const where = (clauses: string[]) => (clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '')

/** A finder's filters: each `filters[k]` that is not None, as its clause (through its conversion). */
function filtered(filters: Record<string, unknown>, m: Record<string, [string, ((v: unknown) => unknown)?]>): [string, unknown[]] {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const [k, [sql, conv]] of Object.entries(m)) {
    const v = filters[k]
    if (v === null || v === undefined) continue
    clauses.push(sql)
    params.push(conv ? conv(v) : v)
  }
  return [where(clauses), params]
}

/** The `x = ?` clause of each argument that is not None. */
function equal(pairs: [string, unknown][]): [string[], unknown[]] {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const [col, v] of pairs) {
    if (v === null || v === undefined) continue
    clauses.push(`${col} = ?`)
    params.push(v)
  }
  return [clauses, params]
}

/** `body.model_dump(exclude={..., id}, exclude_unset=True)`. */
function updatesOf({ value, set }: Body, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of set) if (k !== id) out[k] = value[k]
  return out
}

const given = (u: Record<string, unknown>, k: string) => k in u && u[k] !== null && u[k] !== undefined

function exists(conn: Conn, sql: string, v: unknown): boolean {
  return conn.execute(sql, [v]).fetchone() !== null
}

/** The `UPDATE` an `update_*` method ends with, and the row it leaves. */
function update(conn: Conn, w: { now: () => string }, table: string, key: string, id: unknown, sets: string[], params: unknown[]) {
  if (sets.length === 0) throw new ValueError('No fields to update')
  sets.push('sys_updated_on = ?')
  params.push(w.now())
  params.push(id)
  const cur = conn.execute(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${key} = ?`, params)
  if (cur.rowcount === 0) throw new ValueError(`${key} not found`)
  conn.commit()
  return conn.execute(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]).fetchone()
}

const RETRIEVE_INSTALLED: Model = {
  installed_product_id: OPT_INT,
  location_id: OPT_INT,
  account_id: OPT_INT,
  product_id: OPT_INT,
  serial_number: OPT_STR,
  status: opt({ enum: INSTALLED_STATUS }),
  warranty_end: OPT_STR,
  created_before: OPT_STR,
  created_after: OPT_STR,
}

const FIND_CONTRACTS: Model = {
  contract_id: OPT_INT,
  status: opt({ enum: CONTRACT_STATUS }),
  account_id: OPT_INT,
  contract_type: opt({ enum: CONTRACT_TYPE }),
  start_date: OPT_STR,
  end_date: OPT_STR,
  contract_price: OPT_INT,
  contract_price_range_start: OPT_INT,
  contract_price_range_end: OPT_INT,
  created_before: OPT_STR,
  created_after: OPT_STR,
}

const FIND_ENTITLEMENTS: Model = {
  entitlement_id: OPT_INT,
  account_id: OPT_INT,
  product_id: OPT_INT,
  contract_id: OPT_INT,
  support_level: opt({ enum: SUPPORT_LEVEL }),
  coverage_hours: opt({ enum: COVERAGE_HOURS }),
  max_cases_per_month: OPT_INT,
  active: OPT_BOOL,
  created_before: OPT_STR,
  created_after: OPT_STR,
}

const FIND_SLA_DEFINITIONS: Model = {
  sla_def_id: OPT_INT,
  name: OPT_STR,
  metric: opt({ enum: SLA_METRIC }),
  target_mins: OPT_INT,
  pause_on_pending: OPT_BOOL,
  applies_to_priority: opt({ enum: PRIORITY }),
  active: OPT_BOOL,
  created_before: OPT_STR,
  created_after: OPT_STR,
}

export const tools: Record<string, Tool> = {
  installed_product_warranties_ended_count: route(
    'installed_product_warranties_ended_count',
    { account_id: OPT_INT, product_id: OPT_INT, on_date: { type: 'str', required: true } },
    (w, { value: p }) => {
      const conn = w.conn()
      const [clauses, params] = equal([['account_id', p.account_id], ['product_id', p.product_id]])
      const row = conn
        .execute(`SELECT COUNT(*) AS ended_count FROM installed_product${where(['warranty_end IS NOT NULL', 'warranty_end <= ?', ...clauses])}`, [p.on_date, ...params])
        .fetchone()
      return { ended_count: row ? row.ended_count : 0 }
    },
  ),

  avg_installed_per_account_by_status: route(
    'avg_installed_per_account_by_status',
    { product_id: OPT_INT, location_id: OPT_INT, account_id: OPT_INT },
    (w, { value: p }) => {
      const conn = w.conn()
      const [clauses, params] = equal([['product_id', p.product_id], ['location_id', p.location_id], ['account_id', p.account_id]])
      const sql = `
                WITH per_acct AS (
                    SELECT account_id, status, COUNT(*) AS cnt
                    FROM installed_product
                    ${where(clauses)}
                    GROUP BY account_id, status
                )
                SELECT
                    account_id,
                    status,
                    AVG(cnt) OVER (PARTITION BY status) AS avg_installed_per_account
                FROM per_acct
                ORDER BY account_id, status
            `
      return conn.execute(sql, params).fetchall()
    },
  ),

  count_installed_product_by_status: route(
    'count_installed_product_by_status',
    { account_id: OPT_INT, product_id: OPT_INT, location_id: OPT_INT },
    (w, { value: p }) => {
      const conn = w.conn()
      const [clauses, params] = equal([['account_id', p.account_id], ['product_id', p.product_id], ['location_id', p.location_id]])
      return conn
        .execute(`SELECT status, COUNT(*) AS count
                    FROM installed_product
                    ${where(clauses)}
                    GROUP BY status
                    ORDER BY status`, params)
        .fetchall()
    },
  ),

  retrieve_installed_products: route('retrieve_installed_products', RETRIEVE_INSTALLED, (w, { value }) => {
    const conn = w.conn()
    const [whereSql, params] = filtered(value, {
      installed_product_id: ['installed_product_id = ?'],
      location_id: ['location_id = ?'],
      account_id: ['account_id = ?'],
      product_id: ['product_id = ?'],
      serial_number: ['serial_number LIKE ?', like],
      status: ['status = ?'],
      warranty_end: ['warranty_end = ?'],
      created_before: ['sys_created_on <= ?'],
      created_after: ['sys_created_on >= ?'],
    })
    return conn
      .execute(`SELECT installed_product_id, account_id, product_id, location_id,
                           serial_number, status, warranty_end, sys_created_on
                    FROM installed_product${whereSql}
                    ORDER BY installed_product_id`, params)
      .fetchall()
  }),

  count_contract_by_status: route(
    'count_contract_by_status',
    { account_id: OPT_INT, contract_type: opt({ enum: CONTRACT_TYPE }) },
    (w, { value: p }) => {
      const conn = w.conn()
      const [clauses, params] = equal([['account_id', p.account_id], ['contract_type', p.contract_type]])
      return conn
        .execute(`SELECT status, COUNT(*) AS count
                    FROM contract ${where(clauses)}
                    GROUP BY status
                    ORDER BY status`, params)
        .fetchall()
    },
  ),

  avg_contracts_per_account_by_status: route(
    'avg_contracts_per_account_by_status',
    { contract_type: opt({ enum: CONTRACT_TYPE }) },
    (w, { value: p }) => {
      const conn = w.conn()
      const [clauses, params] = equal([['contract_type', p.contract_type]])
      const sql = `
                WITH per_acct AS (
                  SELECT account_id, status, COUNT(*) AS cnt
                  FROM contract
                  ${where(clauses)}
                  GROUP BY account_id, status
                )
                SELECT status, AVG(cnt) AS avg_contracts_per_account
                FROM per_acct
                GROUP BY status
                ORDER BY status
            `
      return conn.execute(sql, params).fetchall()
    },
  ),

  find_contracts: route('find_contracts', FIND_CONTRACTS, (w, { value }) => {
    const conn = w.conn()
    const [whereSql, params] = filtered(value, {
      contract_id: ['contract_id = ?'],
      status: ['status = ?'],
      account_id: ['account_id = ?'],
      contract_type: ['contract_type = ?'],
      start_date: ['start_date = ?'],
      end_date: ['end_date = ?'],
      contract_price: ['contract_price = ?'],
      contract_price_range_start: ['contract_price >= ?'],
      contract_price_range_end: ['contract_price <= ?'],
      created_before: ['sys_created_on <= ?'],
      created_after: ['sys_created_on >= ?'],
    })
    return conn
      .execute(`SELECT contract_id, account_id, contract_type, status, contract_price,
                           start_date, end_date, sys_created_on
                    FROM contract${whereSql}
                    ORDER BY contract_id`, params)
      .fetchall()
  }),

  total_sum_of_max_cases_per_support_level: route(
    'total_sum_of_max_cases_per_support_level',
    { support_level: opt({ enum: SUPPORT_LEVEL }) },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.support_level) {
        const row = conn.execute('SELECT COALESCE(SUM(max_cases_per_month),0) AS sum FROM entitlement WHERE support_level = ?', [p.support_level]).fetchone()
        return { support_level: p.support_level, sum: row ? row.sum : 0 }
      }
      const row = conn.execute('SELECT COALESCE(SUM(max_cases_per_month),0) AS sum FROM entitlement').fetchone()
      return { support_level: 'all', sum: row ? row.sum : 0 }
    },
  ),

  find_entitlements: route('find_entitlements', FIND_ENTITLEMENTS, (w, { value }) => {
    const conn = w.conn()
    const [whereSql, params] = filtered(value, {
      entitlement_id: ['entitlement_id = ?'],
      account_id: ['account_id = ?'],
      product_id: ['product_id = ?'],
      contract_id: ['contract_id = ?'],
      support_level: ['support_level = ?'],
      coverage_hours: ['coverage_hours = ?'],
      max_cases_per_month: ['max_cases_per_month = ?'],
      active: ['active = ?', one],
      created_before: ['sys_created_on <= ?'],
      created_after: ['sys_created_on >= ?'],
    })
    return conn
      .execute(`SELECT entitlement_id, account_id, product_id, contract_id,
                           support_level, coverage_hours, max_cases_per_month, active, sys_created_on
                    FROM entitlement${whereSql}
                    ORDER BY entitlement_id`, params)
      .fetchall()
  }),

  total_sum_of_target_mins_per_priority: route(
    'total_sum_of_target_mins_per_priority',
    { priority: opt({ enum: PRIORITY }) },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.priority) {
        const row = conn.execute('SELECT COALESCE(SUM(target_mins),0) AS sum FROM sla_definition WHERE applies_to_priority = ?', [p.priority]).fetchone()
        return { priority: p.priority, sum: row ? row.sum : 0 }
      }
      const row = conn.execute('SELECT COALESCE(SUM(target_mins),0) AS sum FROM sla_definition').fetchone()
      return { priority: 'all', sum: row ? row.sum : 0 }
    },
  ),

  find_sla_definitions: route('find_sla_definitions', FIND_SLA_DEFINITIONS, (w, { value }) => {
    const conn = w.conn()
    const [whereSql, params] = filtered(value, {
      sla_def_id: ['sla_def_id = ?'],
      name: ['name LIKE ?', like],
      metric: ['metric = ?'],
      target_mins: ['target_mins = ?'],
      pause_on_pending: ['pause_on_pending = ?', one],
      applies_to_priority: ['applies_to_priority = ?'],
      active: ['active = ?', one],
      created_before: ['sys_created_on <= ?'],
      created_after: ['sys_created_on >= ?'],
    })
    return conn
      .execute(`SELECT sla_def_id, name, metric, target_mins, pause_on_pending,
                           applies_to_priority, active, sys_created_on
                    FROM sla_definition${whereSql}
                    ORDER BY sla_def_id`, params)
      .fetchall()
  }),

  average_target_mins_per_priority: route(
    'average_target_mins_per_priority',
    { priority_list: opt({ list: { enum: PRIORITY } }) },
    (w, { value: p }) => {
      const conn = w.conn()
      const clauses = ['applies_to_priority IS NOT NULL']
      const params: unknown[] = []
      const list = p.priority_list as string[] | null
      if (list && list.length > 0) {
        clauses.push(`applies_to_priority IN (${Array(list.length).fill('?').join(',')})`)
        params.push(...list)
      }
      const rows = conn
        .execute(`SELECT applies_to_priority AS priority,
                           AVG(target_mins) AS avg_target_mins
                    FROM sla_definition
                    ${where(clauses)}
                    GROUP BY applies_to_priority
                    ORDER BY applies_to_priority`, params)
        .fetchall()
      const out: Record<string, unknown> = {}
      for (const r of rows) out[String(r.priority)] = r.avg_target_mins
      return out
    },
  ),

  register_new_installed_product: route(
    'register_new_installed_product',
    {
      location_id: OPT_INT,
      account_id: { type: 'int', required: true },
      product_id: { type: 'int', required: true },
      serial_number: { type: 'str', required: true, minLength: 1 },
      status: { type: { enum: INSTALLED_STATUS }, required: true },
      warranty_end: OPT_STR,
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (!exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', p.account_id)) throw new ValueError('Invalid account_id')
      if (!exists(conn, 'SELECT 1 FROM product WHERE product_id = ?', p.product_id)) throw new ValueError('Invalid product_id')
      if (p.location_id !== null && !exists(conn, 'SELECT 1 FROM location WHERE location_id = ?', p.location_id)) {
        throw new ValueError('Invalid location_id')
      }
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO installed_product(account_id,product_id,location_id,serial_number,status,warranty_end,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?,?,?)`,
        [p.account_id, p.product_id, p.location_id, p.serial_number, p.status, p.warranty_end, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM installed_product WHERE installed_product_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_installed_product_details: route(
    'update_installed_product_details',
    {
      installed_product_id: { type: 'int', required: true },
      location_id: OPT_INT,
      account_id: OPT_INT,
      product_id: OPT_INT,
      serial_number: opt('str', { minLength: 1 }),
      status: opt({ enum: INSTALLED_STATUS }),
      warranty_end: OPT_STR,
    },
    (w, body) => {
      const u = updatesOf(body, 'installed_product_id')
      const conn = w.conn()
      const sets: string[] = []
      const params: unknown[] = []
      for (const [fld, table] of [['account_id', 'account'], ['product_id', 'product'], ['location_id', 'location']] as const) {
        if (!given(u, fld)) continue
        if (!exists(conn, `SELECT 1 FROM ${table} WHERE ${fld} = ?`, u[fld])) throw new ValueError(`Invalid ${fld}`)
        sets.push(`${fld} = ?`)
        params.push(u[fld])
      }
      for (const fld of ['serial_number', 'status', 'warranty_end']) {
        if (!given(u, fld)) continue
        sets.push(`${fld} = ?`)
        params.push(u[fld])
      }
      return update(conn, w, 'installed_product', 'installed_product_id', body.value.installed_product_id, sets, params)
    },
  ),

  enlist_new_contract: route(
    'enlist_new_contract',
    {
      account_id: { type: 'int', required: true },
      contract_type: { type: { enum: CONTRACT_TYPE }, required: true },
      contract_price: OPT_INT,
      status: { type: { enum: CONTRACT_STATUS }, required: true },
      start_date: { type: 'str', required: true },
      end_date: { type: 'str', required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (!exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', p.account_id)) throw new ValueError('Invalid account_id')
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO contract(account_id,contract_type,contract_price,status,start_date,end_date,sys_created_on,sys_updated_on)
                VALUES(?,?,?,?,?,?,?,?)`,
        [p.account_id, p.contract_type, p.contract_price, p.status, p.start_date || now, p.end_date, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM contract WHERE contract_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_contract: route(
    'update_contract',
    {
      contract_id: { type: 'int', required: true },
      account_id: OPT_INT,
      contract_price: OPT_INT,
      contract_type: opt({ enum: CONTRACT_TYPE }),
      status: opt({ enum: CONTRACT_STATUS }),
      start_date: OPT_STR,
      end_date: OPT_STR,
    },
    (w, body) => {
      const u = updatesOf(body, 'contract_id')
      const conn = w.conn()
      const sets: string[] = []
      const params: unknown[] = []
      if (given(u, 'account_id')) {
        if (!exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', u.account_id)) throw new ValueError('Invalid account_id')
        sets.push('account_id = ?')
        params.push(u.account_id)
      }
      for (const fld of ['contract_price', 'contract_type', 'status', 'start_date', 'end_date']) {
        if (!given(u, fld)) continue
        sets.push(`${fld} = ?`)
        params.push(u[fld])
      }
      return update(conn, w, 'contract', 'contract_id', body.value.contract_id, sets, params)
    },
  ),

  add_new_entitlement: route(
    'add_new_entitlement',
    {
      account_id: { type: 'int', required: true },
      product_id: OPT_INT,
      contract_id: OPT_INT,
      support_level: { type: { enum: SUPPORT_LEVEL }, required: true },
      coverage_hours: opt({ enum: COVERAGE_HOURS }),
      max_cases_per_month: opt('int', { default: 0 }),
      active: { type: 'bool', required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (!exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', p.account_id)) throw new ValueError('Invalid account_id')
      if (p.product_id !== null && !exists(conn, 'SELECT 1 FROM product WHERE product_id = ?', p.product_id)) throw new ValueError('Invalid product_id')
      if (p.contract_id !== null) {
        const contract = conn.execute('SELECT account_id FROM contract WHERE contract_id = ?', [p.contract_id]).fetchone()
        if (!contract) throw new ValueError('Invalid contract_id')
        if (String(contract.account_id) !== String(p.account_id)) throw new ValueError('contract_id does not belong to the provided account_id')
      }
      const now = w.now()
      const cur = conn.execute(
        `
                INSERT INTO entitlement
                    (account_id, product_id, contract_id, support_level, coverage_hours,
                    max_cases_per_month, active, sys_created_on, sys_updated_on)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
        [p.account_id, p.product_id, p.contract_id, p.support_level, p.coverage_hours || 'h8x5', p.max_cases_per_month, one(p.active), now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM entitlement WHERE entitlement_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_entitlement: route(
    'update_entitlement',
    {
      entitlement_id: { type: 'int', required: true },
      account_id: OPT_INT,
      product_id: OPT_INT,
      contract_id: OPT_INT,
      support_level: opt({ enum: SUPPORT_LEVEL }),
      coverage_hours: opt({ enum: COVERAGE_HOURS }),
      max_cases_per_month: OPT_INT,
      active: OPT_BOOL,
    },
    (w, body) => {
      const u = updatesOf(body, 'entitlement_id')
      const id = body.value.entitlement_id
      const conn = w.conn()
      const row = conn.execute('SELECT account_id, contract_id FROM entitlement WHERE entitlement_id = ?', [id]).fetchone()
      if (!row) throw new ValueError('entitlement_id not found')
      const wantsAccount = given(u, 'account_id')
      const wantsContract = given(u, 'contract_id')
      const account = wantsAccount ? u.account_id : row.account_id
      const contract = wantsContract ? u.contract_id : row.contract_id
      const sets: string[] = []
      const params: unknown[] = []
      if (wantsAccount && !exists(conn, 'SELECT 1 FROM account WHERE account_id = ?', account)) throw new ValueError('Invalid account_id')
      if (given(u, 'product_id') && !exists(conn, 'SELECT 1 FROM product WHERE product_id = ?', u.product_id)) throw new ValueError('Invalid product_id')
      if (wantsContract) {
        const c = conn.execute('SELECT account_id FROM contract WHERE contract_id = ?', [contract]).fetchone()
        if (!c) throw new ValueError('Invalid contract_id')
        if (String(c.account_id) !== String(account)) throw new ValueError('contract_id does not belong to the provided/effective account_id')
      } else if (contract !== null) {
        const c = conn.execute('SELECT account_id FROM contract WHERE contract_id = ?', [contract]).fetchone()
        if (!c) throw new ValueError('Existing contract_id on entitlement is invalid')
        if (String(c.account_id) !== String(account)) {
          throw new ValueError('account_id cannot be changed because existing contract_id belongs to a different account')
        }
      }
      if (wantsAccount) {
        sets.push('account_id = ?')
        params.push(account)
      }
      if (given(u, 'product_id')) {
        sets.push('product_id = ?')
        params.push(u.product_id)
      }
      if (wantsContract) {
        sets.push('contract_id = ?')
        params.push(contract)
      }
      for (const fld of ['support_level', 'coverage_hours', 'max_cases_per_month']) {
        if (!given(u, fld)) continue
        sets.push(`${fld} = ?`)
        params.push(u[fld])
      }
      if (given(u, 'active')) {
        sets.push('active = ?')
        params.push(one(u.active))
      }
      return update(conn, w, 'entitlement', 'entitlement_id', id, sets, params)
    },
  ),

  add_new_sla_definition: route(
    'add_new_sla_definition',
    {
      metric: { type: { enum: SLA_METRIC }, required: true },
      name: { type: 'str', required: true, minLength: 1 },
      target_mins: { type: 'int', required: true },
      pause_on_pending: { type: 'bool', required: true },
      applies_to_priority: opt({ enum: PRIORITY }),
      active: { type: 'bool', required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      const now = w.now()
      // A taken name gets the first free `-<n>` suffix, from 2.
      const base = p.name as string
      let name = base
      let suffix = 1
      while (exists(conn, 'SELECT 1 FROM sla_definition WHERE name = ?', name)) {
        suffix += 1
        name = `${base}-${suffix}`
      }
      const cur = conn.execute(
        `INSERT INTO sla_definition(name,metric,target_mins,pause_on_pending,applies_to_priority,active,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?,?,?)`,
        [name, p.metric, p.target_mins, one(p.pause_on_pending), p.applies_to_priority, one(p.active), now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM sla_definition WHERE sla_def_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_sla_definition: route(
    'update_sla_definition',
    {
      sla_def_id: { type: 'int', required: true },
      name: opt('str', { minLength: 1 }),
      metric: opt({ enum: SLA_METRIC }),
      target_mins: OPT_INT,
      pause_on_pending: OPT_BOOL,
      applies_to_priority: opt({ enum: PRIORITY }),
      active: OPT_BOOL,
    },
    (w, body) => {
      const u = updatesOf(body, 'sla_def_id')
      const id = body.value.sla_def_id
      const conn = w.conn()
      const sets: string[] = []
      const params: unknown[] = []
      if (given(u, 'name')) {
        if (conn.execute('SELECT 1 FROM sla_definition WHERE name = ? AND sla_def_id <> ?', [u.name, id]).fetchone()) {
          throw new ValueError('SLA definition name already exists')
        }
        sets.push('name = ?')
        params.push(u.name)
      }
      for (const fld of ['metric', 'target_mins', 'applies_to_priority']) {
        if (!given(u, fld)) continue
        sets.push(`${fld} = ?`)
        params.push(u[fld])
      }
      for (const fld of ['pause_on_pending', 'active']) {
        if (!given(u, fld)) continue
        sets.push(`${fld} = ?`)
        params.push(one(u[fld]))
      }
      return update(conn, w, 'sla_definition', 'sla_def_id', id, sets, params)
    },
  ),
}
