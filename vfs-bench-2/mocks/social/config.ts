/**
 * The social fake's kit config, its client and where upstream's social mock
 * is.
 *
 * Upstream is LiveClawBench's social mock (Mosi-AI/LiveClawBench @ 303dc77,
 * MIT, mock-platform/mocks/social). This fake keeps its routes, request and
 * response JSON, pages, cookie login and error envelopes, on Mirage's integ
 * kit: one SQLite file per run, `/_run/<id>` routing, `/reset` and a frozen
 * clock.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PrismaClient } from './client/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Mirage's integ package, whose kit and tools this fake runs on. */
export const INTEG = join(HERE, '..', '..', 'submodule', 'mirage', 'integ')

/** Upstream's mock platform, in the checkout `liveclawbench/setup.py` downloads. */
export const PLATFORM =
  process.env.LIVECLAWBENCH_PLATFORM ?? join(HERE, '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform')

/** Upstream's social mock. */
export const UPSTREAM = join(PLATFORM, 'mocks', 'social')

/** Upstream's mock-lib, whose app factory and auth middleware the mock is built on. */
export const MOCK_LIB = join(PLATFORM, 'packages', 'mock-lib')

export const config = parseConfig({
  service: 'social',
  schema: join(HERE, 'social.prisma'),
  // One platform's world per run, as upstream's mock is one platform's.
  tenantKind: 'none',
})

/**
 * The run's client, which knows its own file: upstream's handlers run their
 * own SQL, synchronously, on it (sqlite.ts).
 */
export class SocialClient extends PrismaClient {
  readonly file: string

  constructor(options: { datasourceUrl: string }) {
    super(options)
    this.file = options.datasourceUrl.replace(/^file:/, '')
  }
}

export type C = SocialClient
