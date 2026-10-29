/**
 * The scheduler fake: Claw-Eval's scheduler service on Mirage's integ kit.
 * A run's jobs are its fixture's; its audit log and the created, updated
 * and deleted copies start empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { schedulerRoutes } from './routes.ts'

export const schedulerFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, schedulerRoutes)
