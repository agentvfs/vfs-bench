/**
 * The CRM fake: Claw-Eval's crm service on Mirage's integ kit. A run's
 * customers are its fixture's; its audit log and its exported reports start
 * empty.
 */
import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { crmRoutes } from './routes.ts'

export const crmFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, crmRoutes)
