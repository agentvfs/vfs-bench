/**
 * The health fake: LiveClawBench's health mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { HealthClient, config } from './config.ts'

export const healthFake = upstreamFake(serviceSpec('health'), config, HealthClient, Prisma.dmmf as unknown as Dmmf)
