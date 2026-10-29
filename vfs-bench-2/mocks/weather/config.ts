/**
 * The weather fake's kit config and client.
 *
 * Upstream is LiveClawBench's weather mock (Mosi-AI/LiveClawBench @ 303dc77,
 * MIT, mock-platform/mocks/weather). This fake keeps its routes, pages and
 * JSON, unauthenticated as upstream's are, on Mirage's integ kit: one SQLite
 * file per run, `/_run/<id>` routing, `/reset` and a frozen clock.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { PrismaClient } from './client/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export const config = parseConfig({
  service: 'weather',
  schema: join(HERE, 'weather.prisma'),
  tenantKind: 'none',
})

export type C = PrismaClient
