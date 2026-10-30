/**
 * The smarthome fake's kit config and its client.
 *
 * Upstream is LiveClawBench's smarthome mock (Mosi-AI/LiveClawBench @ 303dc77,
 * MIT, mock-platform/mocks/smarthome), which this fake runs as it is, on
 * Mirage's integ kit: one SQLite file per run, `/_run/<id>` routing,
 * `/reset` and a frozen clock (mocks/upstream).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PrismaClient } from './client/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export const config = parseConfig({
  service: 'smarthome',
  schema: join(HERE, 'smarthome.prisma'),
  // One world per run, as upstream's mock is one.
  tenantKind: 'none',
})

/** The run's client, which knows its own file: upstream's mock runs its own SQL on it. */
export class SmarthomeClient extends PrismaClient {
  readonly file: string

  constructor(options: { datasourceUrl: string }) {
    super(options)
    this.file = options.datasourceUrl.replace(/^file:/, '')
  }

  /** Export the unmodeled table using this service's existing store client.
   * Unlike the public API's alphabetical order, preserve insertion order:
   * the reference grader chooses the first matching product. No grading
   * predicates or new database connection belong in this state export.
   */
  async snapshotGroceryRows(): Promise<Record<string, unknown>[]> {
    return this.$queryRawUnsafe('SELECT * FROM grocery_product ORDER BY rowid')
  }
}
