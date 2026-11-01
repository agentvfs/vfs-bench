/**
 * CSM's account, contact and lookup tools: ports of `CSMManager`'s methods
 * and their routes (sn-csm-server's database/csm_manager.py and
 * apis/csm_apis.py, read from the image's bytecode).
 */
import { HTTPException, ValueError } from '../../enterpriseops/errors.ts'
import type { Tool } from '../../enterpriseops/fake.ts'
import { route, rowDict } from '../api.ts'
import { ACCOUNT_TYPE } from './models.ts'

const NAME = { name: { type: 'str', required: true } } as const

/** A lookup route: 404 when the manager found nothing (`None`), `{}` as it is. */
function found<T>(res: T | null, what: string): T {
  if (res === null || res === undefined) throw new HTTPException(404, `${what} not found`)
  return res
}

export const tools: Record<string, Tool> = {
  find_account: route('find_account', NAME, (w, { value }) => {
    const conn = w.conn()
    const row = conn.execute('SELECT account_id, name, account_type, email_domain, active FROM account WHERE name = ?', [value.name]).fetchone()
    return found(rowDict(row), 'Account')
  }),

  find_product: route('find_product', NAME, (w, { value }) => {
    const conn = w.conn()
    const row = conn.execute('SELECT product_id, name, category, lifecycle_state FROM product WHERE name = ?', [value.name]).fetchone()
    return found(rowDict(row), 'Product')
  }),

  create_new_account: route(
    'create_new_account',
    {
      name: { type: 'str', required: true, minLength: 1 },
      email_domain: { type: 'str', nullable: true },
      account_type: { type: { enum: ACCOUNT_TYPE }, required: true },
      active: { type: 'bool', required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (conn.execute('SELECT 1 FROM account WHERE name = ?', [p.name]).fetchone()) throw new ValueError('Account name already exists')
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO account(name,email_domain,account_type,active,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?)`,
        [p.name, p.email_domain, p.account_type, p.active ? 1 : 0, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM account WHERE account_id = ?', [cur.lastrowid]).fetchone()
    },
  ),

  create_contact: route(
    'create_contact',
    {
      account_id: { type: 'int', required: true },
      portal_user_id: { type: 'int', required: true },
      active: { type: 'bool', required: true },
      is_primary: { type: 'bool', required: true },
    },
    (w, { value: p }) => {
      const conn = w.conn()
      if (!conn.execute('SELECT 1 FROM account WHERE account_id = ?', [p.account_id]).fetchone()) throw new ValueError('Invalid account_id')
      if (!conn.execute('SELECT 1 FROM "user" WHERE user_id = ?', [p.portal_user_id]).fetchone()) throw new ValueError('Invalid portal_user_id')
      if (conn.execute('SELECT 1 FROM contact WHERE portal_user_id = ?', [p.portal_user_id]).fetchone()) {
        throw new ValueError('portal_user_id already linked to a contact')
      }
      const now = w.now()
      const cur = conn.execute(
        `INSERT INTO contact(account_id,portal_user_id,active,is_primary,sys_created_on,sys_updated_on)
                   VALUES(?,?,?,?,?,?)`,
        [p.account_id, p.portal_user_id, p.active ? 1 : 0, p.is_primary ? 1 : 0, now, now],
      )
      conn.commit()
      return conn.execute('SELECT * FROM contact WHERE contact_id = ?', [cur.lastrowid]).fetchone()
    },
  ),
}
