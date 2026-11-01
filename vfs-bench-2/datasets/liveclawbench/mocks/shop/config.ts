/**
 * The shop fake's kit config and its client.
 *
 * Upstream is LiveClawBench's shop mock (Mosi-AI/LiveClawBench @ 303dc77,
 * MIT, mock-platform/mocks/shop), which this fake runs as it is, on
 * Mirage's integ kit: one SQLite file per run, `/_run/<id>` routing,
 * `/reset` and a frozen clock (mocks/upstream).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PrismaClient } from './client/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export const config = parseConfig({
  service: 'shop',
  schema: join(HERE, 'shop.prisma'),
  // One world per run, as upstream's mock is one.
  tenantKind: 'none',
})

/** The run's client, which knows its own file: upstream's mock runs its own SQL on it. */
export class ShopClient extends PrismaClient {
  readonly file: string

  constructor(options: { datasourceUrl: string }) {
    super(options)
    this.file = options.datasourceUrl.replace(/^file:/, '')
  }
}
