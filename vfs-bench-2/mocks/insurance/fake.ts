/**
 * The insurance fake: LiveClawBench's insurance mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { InsuranceClient, config } from './config.ts'

export const insuranceFake = upstreamFake(serviceSpec('insurance'), config, InsuranceClient, Prisma.dmmf as unknown as Dmmf)
