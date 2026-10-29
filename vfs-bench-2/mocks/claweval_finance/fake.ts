/**
 * The finance fake: Claw-Eval's finance service on Mirage's integ kit. A
 * run's transactions are its fixture's; its audit log and its submitted
 * reports start empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { financeRoutes } from './routes.ts'

export const financeFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, financeRoutes)
