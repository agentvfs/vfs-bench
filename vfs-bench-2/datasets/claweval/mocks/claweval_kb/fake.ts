/**
 * The knowledge base fake: Claw-Eval's kb service on Mirage's integ kit. A
 * run's articles are its fixture's; its audit log and its updates start
 * empty.
 */
import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { kbRoutes } from './routes.ts'

export const kbFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, kbRoutes)
