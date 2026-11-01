/**
 * CSM's directory tools (users, groups, accounts, contacts, locations,
 * products): ports of `CSMManager`'s methods and their routes
 * (sn-csm-server's database/csm_manager.py and apis/csm_apis.py, read from
 * the image's bytecode).
 */
import { HTTPException, ValueError } from '../../enterpriseops/errors.ts'
import type { Tool } from '../../enterpriseops/fake.ts'
import type { Field, Model } from '../../enterpriseops/model.ts'
import type { Conn } from '../../enterpriseops/sqlite.ts'
import { type Work, route, rowDict } from '../api.ts'
import { ACCOUNT_TYPE, CATEGORY, GROUP_TYPE, LIFECYCLE, ROLE } from './models.ts'

type Row = Record<string, unknown>

// The location models' own Literals: lowercase, unlike models.py's City/Country.
const CITY_LC = ['new_york', 'london', 'mumbai', 'tokyo', 'sydney'] as const
const COUNTRY_LC = ['usa', 'uk', 'india', 'japan', 'australia'] as const

const req = (type: Field['type'], minLength?: number): Field => ({ type, required: true, ...(minLength ? { minLength } : {}) })
const opt = (type: Field['type'], minLength?: number): Field => ({ type, nullable: true, ...(minLength ? { minLength } : {}) })

/**
 * A lookup route: `if not res and res != {}: 404`, so only a `None` is a
 * 404; the manager's `{}` for no row comes back as it is.
 */
function found(res: Row | Record<string, never> | null, detail: string): Row | Record<string, never> {
  if (res === null || res === undefined) throw new HTTPException(404, detail)
  return res
}

function lookup(tool: string, model: Model, sql: string, arg: (v: Record<string, unknown>) => unknown, detail: string): Tool {
  return route(tool, model, (w, { value }) => found(rowDict(w.conn().execute(sql, [arg(value)]).fetchone() as Row | null), detail))
}

const b = (v: unknown) => (v ? 1 : 0)
const like = (v: unknown) => `%${v}%`

/**
 * A listing: each filter given (not None) as its clause, in the manager's
 * order, `conv` mapping its value; then `SELECT <cols> FROM <table>[ WHERE ...] ORDER BY <key>`.
 */
function listing(
  conn: Conn,
  filters: Record<string, unknown>,
  m: [string, string, ((v: unknown) => unknown)?][],
  select: string,
  order: string,
): Row[] {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const [k, sql, conv] of m) {
    const v = filters[k]
    if (v === null || v === undefined) continue
    clauses.push(sql)
    params.push(conv ? conv(v) : v)
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
  return conn.execute(`${select}${where} ORDER BY ${order}`, params).fetchall() as Row[]
}

/**
 * An update: each field given (not None) as `col = ?`, `bools` as 1/0, then
 * `sys_updated_on`; 'No fields to update' when none, `<key> not found` when
 * no row changed. Returns the row after.
 */
function update(
  w: Work,
  conn: Conn,
  table: string,
  key: string,
  id: unknown,
  updates: Record<string, unknown>,
  fields: string[],
  check?: (fld: string, v: unknown) => void,
): Row {
  const sets: string[] = []
  const params: unknown[] = []
  for (const fld of fields) {
    const v = updates[fld]
    if (v === null || v === undefined) continue
    check?.(fld, v)
    sets.push(`${fld} = ?`)
    params.push(typeof v === 'boolean' ? b(v) : v)
  }
  if (sets.length === 0) throw new ValueError('No fields to update')
  sets.push('sys_updated_on = ?')
  params.push(w.now(), id)
  const cur = conn.execute(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${key} = ?`, params)
  if (cur.rowcount === 0) throw new ValueError(`${key} not found`)
  conn.commit()
  return conn.execute(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]).fetchone() as Row
}

const NAME = { name: req('str', 1) }

export const tools: Record<string, Tool> = {
  find_user: route('find_user', NAME, (w, { value }) => {
    const norm = String(value.name).trim().replace(/\s+/gu, ' ')
    const sql = "SELECT user_id, first_name, last_name, email, role, location_id, active FROM user WHERE LOWER(first_name||' '||last_name) = LOWER(?)"
    return found(rowDict(w.conn().execute(sql, [norm]).fetchone() as Row | null), 'User not found')
  }),

  find_user_by_email: lookup(
    'find_user_by_email',
    { email: req('str', 1) },
    'SELECT user_id, first_name, last_name, email, role, location_id, active FROM user WHERE LOWER(email) = LOWER(?)',
    (v) => String(v.email).trim(),
    'User not found',
  ),

  find_contact_by_portal_user: lookup(
    'find_contact_by_portal_user',
    { portal_user_id: req('int') },
    `
                SELECT contact_id, account_id, portal_user_id, active
                FROM contact
                WHERE portal_user_id = ?
                `,
    (v) => v.portal_user_id,
    'Contact not found for portal user',
  ),

  find_product_by_id: lookup(
    'find_product_by_id',
    { product_id: { type: 'int', required: true, ge: 1 } },
    'SELECT product_id, name, category, lifecycle_state FROM product WHERE product_id = ?',
    (v) => v.product_id,
    'Product not found',
  ),

  find_installed_product_by_serial: lookup(
    'find_installed_product_by_serial',
    { serial_number: req('str', 1) },
    `
                SELECT installed_product_id, account_id, product_id, location_id, serial_number, status, warranty_end
                FROM installed_product WHERE serial_number = ?
                `,
    (v) => v.serial_number,
    'Installed product not found',
  ),

  find_location: lookup('find_location', NAME, 'SELECT location_id, name, city, country, active FROM location WHERE name = ?', (v) => v.name, 'Location not found'),

  find_user_group: lookup('find_user_group', NAME, 'SELECT group_id, name, type, active FROM user_group WHERE name = ?', (v) => v.name, 'User group not found'),

  check_user_membership: route('check_user_membership', { user_id: req('int'), group_id: req('int') }, (w, { value }) => {
    const row = w.conn().execute('SELECT member_id FROM user_group_member WHERE user_id = ? AND group_id = ?', [value.user_id, value.group_id]).fetchone() as Row | null
    return { exists: Boolean(row), member_id: row ? row.member_id : null }
  }),

  list_users: route(
    'list_users',
    {
      email: opt('str'),
      user_id: opt('int'),
      first_name: opt('str'),
      last_name: opt('str'),
      phone: opt('str'),
      role: opt({ enum: ROLE }),
      location_id: opt('int'),
      active: opt('bool'),
      created_after: opt('str'),
      created_before: opt('str'),
    },
    (w, { value }) =>
      listing(
        w.conn(),
        value,
        [
          ['email', 'email = ?'],
          ['user_id', 'user_id = ?'],
          ['first_name', 'first_name LIKE ?', like],
          ['last_name', 'last_name LIKE ?', like],
          ['phone', 'phone LIKE ?', like],
          ['role', 'role = ?'],
          ['location_id', 'location_id = ?'],
          ['active', 'active = ?', b],
          ['created_after', 'sys_created_on >= ?'],
          ['created_before', 'sys_created_on <= ?'],
        ],
        `SELECT user_id, first_name, last_name, email, phone, role, location_id, active, sys_created_on
                    FROM "user"`,
        'user_id',
      ),
  ),

  list_user_groups: route(
    'list_user_groups',
    {
      group_id: opt('int'),
      name: opt('str'),
      active: opt('bool'),
      type: opt({ enum: GROUP_TYPE }),
      created_after: opt('str'),
      created_before: opt('str'),
    },
    (w, { value }) =>
      listing(
        w.conn(),
        value,
        [
          ['group_id', 'group_id = ?'],
          ['name', 'name LIKE ?', like],
          ['active', 'active = ?', b],
          ['type', 'type = ?'],
          ['created_after', 'sys_created_on >= ?'],
          ['created_before', 'sys_created_on <= ?'],
        ],
        `SELECT group_id, name, type, active, sys_created_on
                    FROM user_group`,
        'group_id',
      ),
  ),

  list_group_members: route(
    'list_group_members',
    { member_id: opt('int'), group_id: opt('int'), user_id: opt('int'), created_after: opt('str'), created_before: opt('str') },
    (w, { value }) =>
      listing(
        w.conn(),
        value,
        [
          ['member_id', 'member_id = ?'],
          ['group_id', 'group_id = ?'],
          ['user_id', 'user_id = ?'],
          ['created_after', 'sys_created_on >= ?'],
          ['created_before', 'sys_created_on <= ?'],
        ],
        `SELECT member_id, group_id, user_id, sys_created_on
                    FROM user_group_member`,
        'member_id',
      ),
  ),

  get_accounts: route(
    'get_accounts',
    {
      account_id: opt('int'),
      name: opt('str'),
      email_domain: opt('str'),
      account_types: opt({ list: { enum: ACCOUNT_TYPE } }),
      active: opt('bool'),
      created_after: opt('str'),
      created_before: opt('str'),
    },
    (w, { value: f }) => {
      // Unlike the other listings, the string filters are skipped when empty (truthiness).
      const clauses: string[] = []
      const params: unknown[] = []
      if (f.account_id !== null) clauses.push('account_id = ?'), params.push(f.account_id)
      if (f.name) clauses.push('name LIKE ?'), params.push(like(f.name))
      if (f.email_domain) clauses.push('email_domain LIKE ?'), params.push(like(f.email_domain))
      const types = f.account_types as string[] | null
      if (types && types.length > 0) {
        clauses.push(`account_type IN (${types.map(() => '?').join(',')})`)
        params.push(...types)
      }
      if (f.active !== null) clauses.push('active = ?'), params.push(b(f.active))
      if (f.created_after) clauses.push('sys_created_on >= ?'), params.push(f.created_after)
      if (f.created_before) clauses.push('sys_created_on <= ?'), params.push(f.created_before)
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
      return w
        .conn()
        .execute(
          `SELECT account_id, name, email_domain, account_type, active, sys_created_on
                    FROM account${where} ORDER BY account_id`,
          params,
        )
        .fetchall()
    },
  ),

  find_contacts: route(
    'find_contacts',
    {
      contact_id: opt('int'),
      account_id: opt('int'),
      portal_user_id: opt('int'),
      active: opt('bool'),
      is_primary: opt('bool'),
      created_after: opt('str'),
      created_before: opt('str'),
    },
    (w, { value }) =>
      listing(
        w.conn(),
        value,
        [
          ['contact_id', 'contact_id = ?'],
          ['account_id', 'account_id = ?'],
          ['portal_user_id', 'portal_user_id = ?'],
          ['active', 'active = ?', b],
          ['is_primary', 'is_primary = ?', b],
          ['created_after', 'sys_created_on >= ?'],
          ['created_before', 'sys_created_on <= ?'],
        ],
        `SELECT contact_id, account_id, portal_user_id, active, is_primary, sys_created_on
                    FROM contact`,
        'contact_id',
      ),
  ),

  find_locations: route(
    'find_locations',
    {
      location_id: opt('int'),
      name: opt('str'),
      active: opt('bool'),
      plot_no: opt('str'),
      street: opt('str'),
      city: opt('str'),
      country: opt('str'),
      created_before: opt('str'),
      created_after: opt('str'),
    },
    (w, { value }) =>
      listing(
        w.conn(),
        value,
        [
          ['location_id', 'location_id = ?'],
          ['name', 'name LIKE ?', like],
          ['active', 'active = ?', b],
          ['plot_no', 'plot_no LIKE ?', like],
          ['street', 'street LIKE ?', like],
          ['city', 'city = ?'],
          ['country', 'country = ?'],
          ['created_before', 'sys_created_on <= ?'],
          ['created_after', 'sys_created_on >= ?'],
        ],
        `SELECT location_id, name, plot_no, street, city, country, active, sys_created_on
                    FROM location`,
        'location_id',
      ),
  ),

  find_products: route(
    'find_products',
    {
      product_id: opt('int'),
      name: opt('str'),
      category: opt({ enum: CATEGORY }),
      lifecycle_state: opt({ enum: LIFECYCLE }),
      product_price: opt('int'),
      created_before: opt('str'),
      created_after: opt('str'),
    },
    (w, { value }) =>
      listing(
        w.conn(),
        value,
        [
          ['product_id', 'product_id = ?'],
          ['name', 'name LIKE ?', like],
          ['category', 'category = ?'],
          ['lifecycle_state', 'lifecycle_state = ?'],
          ['product_price', 'product_price = ?'],
          ['created_before', 'sys_created_on <= ?'],
          ['created_after', 'sys_created_on >= ?'],
        ],
        `SELECT product_id, name, category, lifecycle_state, product_price, sys_created_on
                    FROM product`,
        'product_id',
      ),
  ),

  add_new_user: route(
    'add_new_user',
    {
      first_name: req('str', 1),
      last_name: req('str', 1),
      email: req('str', 1),
      phone: opt('str'),
      role: req({ enum: ROLE }),
      location_id: opt('int'),
      active: req('bool'),
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (p.location_id !== null && !conn.execute('SELECT 1 FROM location WHERE location_id = ?', [p.location_id]).fetchone()) {
        throw new ValueError('Invalid location_id')
      }
      if (conn.execute('SELECT 1 FROM user WHERE email = ?', [p.email]).fetchone()) throw new ValueError('Email already exists')
      const now = w.now()
      const columns = ['first_name', 'last_name', 'email', 'role', 'location_id', 'active', 'sys_created_on', 'sys_updated_on']
      const values = [p.first_name, p.last_name, p.email, p.role, p.location_id, b(p.active), now, now]
      if (p.phone !== null) {
        columns.splice(3, 0, 'phone')
        values.splice(3, 0, p.phone)
      }
      const cur = conn.execute(`INSERT INTO "user"(${columns.join(',')}) VALUES(${values.map(() => '?').join(',')})`, values)
      conn.commit()
      return conn.execute('SELECT * FROM "user" WHERE user_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_user_details: route(
    'update_user_details',
    {
      user_id: req('int'),
      email: opt('str', 1),
      first_name: opt('str', 1),
      last_name: opt('str', 1),
      active: opt('bool'),
      phone: opt('str', 1),
      role: opt({ enum: ROLE }),
      location_id: opt('int'),
    },
    (w, { value: u }) => {
      const conn = w.conn()
      if (u.email !== null && conn.execute('SELECT 1 FROM "user" WHERE email = ? AND user_id <> ?', [u.email, u.user_id]).fetchone()) {
        throw new ValueError('Email already exists')
      }
      return update(w, conn, '"user"', 'user_id', u.user_id, u, ['email', 'first_name', 'last_name', 'phone', 'role', 'location_id', 'active'], (fld, v) => {
        if (fld === 'location_id' && !conn.execute('SELECT 1 FROM location WHERE location_id = ?', [v]).fetchone()) {
          throw new ValueError('Invalid location_id')
        }
      })
    },
  ),

  add_new_user_group: route(
    'add_new_user_group',
    { name: req('str', 1), type: req({ enum: GROUP_TYPE }), active: req('bool') },
    (w, { value: p }) => {
      const conn = w.conn()
      if (conn.execute('SELECT 1 FROM user_group WHERE name = ?', [p.name]).fetchone()) throw new ValueError('Group name already exists')
      const now = w.now()
      const cur = conn.execute('INSERT INTO user_group(name,type,active,sys_created_on,sys_updated_on) VALUES(?,?,?,?,?)', [p.name, p.type, b(p.active), now, now])
      conn.commit()
      return conn.execute('SELECT * FROM user_group WHERE group_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_user_group: route(
    'update_user_group',
    { group_id: req('int'), name: opt('str', 1), type: opt({ enum: GROUP_TYPE }), active: opt('bool') },
    (w, { value: u }) => {
      const conn = w.conn()
      if (u.name !== null && conn.execute('SELECT 1 FROM user_group WHERE name = ? AND group_id <> ?', [u.name, u.group_id]).fetchone()) {
        throw new ValueError('Group name already exists')
      }
      return update(w, conn, 'user_group', 'group_id', u.group_id, u, ['name', 'type', 'active'])
    },
  ),

  add_new_group_member: route('add_new_group_member', { group_id: req('int'), user_id: req('int') }, (w, { value: p }) => {
    const conn = w.conn()
    if (!conn.execute('SELECT 1 FROM user_group WHERE group_id = ?', [p.group_id]).fetchone()) throw new ValueError('Invalid group_id')
    if (!conn.execute('SELECT 1 FROM "user" WHERE user_id = ?', [p.user_id]).fetchone()) throw new ValueError('Invalid user_id')
    if (conn.execute('SELECT 1 FROM user_group_member WHERE group_id = ? AND user_id = ?', [p.group_id, p.user_id]).fetchone()) {
      throw new ValueError('Membership already exists')
    }
    const cur = conn.execute('INSERT INTO user_group_member(group_id,user_id,sys_created_on) VALUES(?,?,?)', [p.group_id, p.user_id, w.now()])
    conn.commit()
    return conn.execute('SELECT * FROM user_group_member WHERE member_id = ?', [cur.lastrowid]).fetchone()
  }),

  remove_group_membership: route(
    'remove_group_membership',
    { member_id: opt('int'), group_id: opt('int'), user_id: opt('int') },
    (w, { value: p }) => {
      const conn = w.conn()
      let cur
      // Python truthiness: an id of 0 counts as not given.
      if (p.member_id) cur = conn.execute('DELETE FROM user_group_member WHERE member_id = ?', [p.member_id])
      else if (p.group_id && p.user_id) cur = conn.execute('DELETE FROM user_group_member WHERE group_id = ? AND user_id = ?', [p.group_id, p.user_id])
      else throw new ValueError('Provide member_id OR (group_id AND user_id)')
      const count = cur.rowcount
      conn.commit()
      return { deleted: count }
    },
  ),

  update_account_details: route(
    'update_account_details',
    { account_id: req('int'), name: opt('str', 1), email_domain: opt('str'), active: opt('bool'), account_type: opt({ enum: ACCOUNT_TYPE }) },
    (w, { value: u }) => {
      const conn = w.conn()
      if (u.name !== null && conn.execute('SELECT 1 FROM account WHERE name = ? AND account_id <> ?', [u.name, u.account_id]).fetchone()) {
        throw new ValueError('Account name already exists')
      }
      return update(w, conn, 'account', 'account_id', u.account_id, u, ['name', 'email_domain', 'account_type', 'active'])
    },
  ),

  update_contact: route(
    'update_contact',
    { contact_id: req('int'), account_id: opt('int'), portal_user_id: opt('int'), active: opt('bool'), is_primary: opt('bool') },
    (w, { value: u }) => {
      const conn = w.conn()
      return update(w, conn, 'contact', 'contact_id', u.contact_id, u, ['account_id', 'portal_user_id', 'active', 'is_primary'], (fld, v) => {
        if (fld === 'account_id' && !conn.execute('SELECT 1 FROM account WHERE account_id = ?', [v]).fetchone()) throw new ValueError('Invalid account_id')
        if (fld === 'portal_user_id') {
          if (!conn.execute('SELECT 1 FROM "user" WHERE user_id = ?', [v]).fetchone()) throw new ValueError('Invalid portal_user_id')
          if (conn.execute('SELECT 1 FROM contact WHERE portal_user_id = ? AND contact_id <> ?', [v, u.contact_id]).fetchone()) {
            throw new ValueError('portal_user_id already linked to another contact')
          }
        }
      })
    },
  ),

  add_location: route(
    'add_location',
    { name: req('str', 1), active: req('bool'), plot_no: opt('str'), street: opt('str'), city: req({ enum: CITY_LC }), country: req({ enum: COUNTRY_LC }) },
    (w, { value: p }) => {
      const conn = w.conn()
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO location(name,active,plot_no,street,city,country,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?,?,?)`,
        [p.name, b(p.active), p.plot_no, p.street, p.city, p.country, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM location WHERE location_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_location: route(
    'update_location',
    {
      location_id: req('int'),
      name: opt('str', 1),
      active: opt('bool'),
      plot_no: opt('str'),
      street: opt('str'),
      city: opt({ enum: CITY_LC }),
      country: opt({ enum: COUNTRY_LC }),
    },
    (w, { value: u }) => update(w, w.conn(), 'location', 'location_id', u.location_id, u, ['name', 'plot_no', 'street', 'city', 'country', 'active']),
  ),

  add_new_product: route(
    'add_new_product',
    { name: req('str', 1), category: req({ enum: CATEGORY }), lifecycle_state: req({ enum: LIFECYCLE }), product_price: opt('int') },
    (w, { value: p }) => {
      const conn = w.conn()
      if (conn.execute('SELECT 1 FROM product WHERE name = ?', [p.name]).fetchone()) throw new ValueError('Product name already exists')
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO product(name,category,lifecycle_state,product_price,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?)`,
        [p.name, p.category, p.lifecycle_state, p.product_price, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM product WHERE product_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  update_product: route(
    'update_product',
    { product_id: req('int'), name: opt('str', 1), category: opt({ enum: CATEGORY }), product_price: opt('int'), lifecycle_state: opt({ enum: LIFECYCLE }) },
    (w, { value: u }) => {
      const conn = w.conn()
      if (u.name !== null && conn.execute('SELECT 1 FROM product WHERE name = ? AND product_id <> ?', [u.name, u.product_id]).fetchone()) {
        throw new ValueError('Product name already exists')
      }
      return update(w, conn, 'product', 'product_id', u.product_id, u, ['name', 'category', 'product_price', 'lifecycle_state'])
    },
  ),

  delete_products: route(
    'delete_products',
    {
      product_id: opt('int'),
      name: opt('str', 1),
      category: opt({ enum: CATEGORY }),
      lifecycle_state: opt({ enum: LIFECYCLE }),
      product_price: opt('int'),
      created_before: opt('str'),
      created_after: opt('str'),
    },
    (w, { value: f }) => {
      const conn = w.conn()
      const m: [string, string][] = [
        ['product_id', 'product_id = ?'],
        ['name', 'name = ?'],
        ['category', 'category = ?'],
        ['lifecycle_state', 'lifecycle_state = ?'],
        ['product_price', 'product_price = ?'],
        ['created_before', 'sys_created_on <= ?'],
        ['created_after', 'sys_created_on >= ?'],
      ]
      const given = m.filter(([k]) => f[k] !== null)
      if (given.length === 0) throw new ValueError('Refuse to delete without any filter')
      const cur = conn.execute(`DELETE FROM product WHERE ${given.map(([, sql]) => sql).join(' AND ')}`, given.map(([k]) => f[k]))
      const count = cur.rowcount
      conn.commit()
      return { deleted: count }
    },
  ),
}
