/**
 * The CSM fake: EnterpriseOps-Gym's `sn-csm-server` on Mirage's integ kit
 * (mocks/enterpriseops/fake.ts). Its tables are upstream's
 * `sql/csm_schema_sqlite.sql` (`schema.sql`, as the image ships it).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { type Tool, serverFake } from '../enterpriseops/fake.ts'
import { Prisma } from './client/index.js'
import { CsmClient, config } from './config.ts'
import { tools as accounts } from './tools/accounts.ts'
import { tools as assets } from './tools/assets.ts'
import { tools as cases } from './tools/cases.ts'
import { tools as directory } from './tools/directory.ts'
import { tools as knowledge } from './tools/knowledge.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Upstream's tables, in the order its seed route lists them. */
const TABLES = [
  'location', 'user', 'user_group', 'account', 'product', 'installed_product', 'contact', 'contract', 'entitlement',
  'sla_definition', 'customer_case', 'case_sla', 'interaction', 'knowledge', 'case_knowledge', 'notification',
  'user_group_member',
]

export const tools: Record<string, Tool> = { ...accounts, ...directory, ...assets, ...cases, ...knowledge }

export const fake: Fake<CsmClient> = serverFake(
  {
    tools,
    schema: join(HERE, 'schema.sql'),
    // Upstream's MCP handler: the caller must be a user of the database.
    before: (ctx) => {
      if (ctx.userEmail === undefined) return { text: 'Error: x-user-email header is required for user identification', isError: true }
      const conn = ctx.open()
      try {
        const row = conn
          .execute('SELECT user_id, first_name, last_name, email, role, location_id, active FROM user WHERE LOWER(email) = LOWER(?)', [
            ctx.userEmail.trim(),
          ])
          .fetchone()
        return row ? null : { text: 'Error: User not found for given email', isError: true }
      } finally {
        conn.close()
      }
    },
    // Upstream's `/api/seed-database` for a fresh database whose seed makes
    // no tables of its own (none of gym_dbs.zip's does): upstream's schema,
    // then the seed's script, foreign keys off.
    seed: (conn, schema, sql) => {
      if (TABLES.some((t) => new RegExp(`\\bcreate\\s+table\\b.*\\b${t}\\b`, 'is').test(sql))) {
        throw new Error('this seed makes its own tables, which the fake does not seed as upstream does')
      }
      conn.executescript(schema)
      conn.execute('PRAGMA foreign_keys=OFF;')
      conn.executescript(sql)
      conn.execute('PRAGMA foreign_keys=ON;')
    },
  },
  config,
  CsmClient,
  Prisma.dmmf as unknown as Dmmf,
)
