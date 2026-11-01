/**
 * The smarthome fake: LiveClawBench's smarthome mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { SmarthomeClient, config } from './config.ts'

export const smarthomeFake = upstreamFake(serviceSpec('smarthome'), config, SmarthomeClient, Prisma.dmmf as unknown as Dmmf)
