/**
 * The LightTalk fake: ComplexMCP's LightTalk on Mirage's integ kit. A run is
 * the task's login (complexmcp/fake.ts).
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { lightFake } from '../complexmcp/fake.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const fake: Fake<C> = lightFake('LightTalk', config, PrismaClient, Prisma.dmmf as unknown as Dmmf)
