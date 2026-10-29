/**
 * The LangServer fake: ComplexMCP's LangServer on Mirage's integ kit. Its
 * tools keep nothing, so a run is empty (complexmcp/fake.ts).
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { plainFake } from '../complexmcp/fake.ts'
import { tools } from '../complexmcp/plain/lang.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const fake: Fake<C> = plainFake(tools, config, PrismaClient, Prisma.dmmf as unknown as Dmmf)
