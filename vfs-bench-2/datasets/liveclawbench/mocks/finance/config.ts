/**
 * The finance fake's kit config, its client and where upstream's finance
 * mock is.
 *
 * Upstream is LiveClawBench's finance mock (Mosi-AI/LiveClawBench @ 303dc77,
 * MIT, mock-platform/mocks/finance). This fake keeps its routes, request and
 * response JSON, pages and cookie login, on Mirage's integ kit: one SQLite
 * file per run, `/_run/<id>` routing, `/reset` and a frozen clock.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { PrismaClient } from './client/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Mirage's integ package, whose kit and tools this fake runs on. */
export const INTEG = join(HERE, '..', '..', '..', '..', 'submodule', 'mirage', 'integ')

/** Upstream's finance mock, in the checkout `liveclawbench/setup.py` downloads. */
export const UPSTREAM =
  process.env.LIVECLAWBENCH_FINANCE ?? join(HERE, '..', '..', '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform', 'mocks', 'finance')

export const config = parseConfig({
  service: 'finance',
  schema: join(HERE, 'finance.prisma'),
  // One company's world per run, as upstream's mock is one company's.
  tenantKind: 'none',
})

export type C = PrismaClient

/** Upstream's `INVOICE_CATEGORY_CODES`, by code (src/constants.ts). */
export const INVOICE_CATEGORY_CODES = ['5000', '5100', '5200', '5300', '5400', '5500', '5600', '5700', '5800', '5900']

/** mock-lib's default `MOCK_TOKEN_EXPIRY_SECONDS`: a session's life, and its cookie's. */
export const TOKEN_EXPIRY_SECONDS = 3600
