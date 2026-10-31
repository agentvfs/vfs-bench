/**
 * The mintdiet fake: LiveClawBench's mint-diet mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { MintdietClient, config } from './config.ts'

export const mintdietFake = upstreamFake(serviceSpec('mintdiet'), config, MintdietClient, Prisma.dmmf as unknown as Dmmf)
