/**
 * The shop fake: LiveClawBench's shop mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { ShopClient, config } from './config.ts'

export const shopFake = upstreamFake(serviceSpec('shop'), config, ShopClient, Prisma.dmmf as unknown as Dmmf)
