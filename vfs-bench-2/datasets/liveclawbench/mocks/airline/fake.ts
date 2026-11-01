/**
 * The airline fake: LiveClawBench's airline mock, upstream's own app, on
 * Mirage's integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { AirlineClient, config } from './config.ts'

export const airlineFake = upstreamFake(serviceSpec('airline'), config, AirlineClient, Prisma.dmmf as unknown as Dmmf)
