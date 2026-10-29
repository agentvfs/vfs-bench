/**
 * The helpdesk fake: Claw-Eval's helpdesk service on Mirage's integ kit. A
 * run's tickets are its fixture's; its audit log starts empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { helpdeskRoutes } from './routes.ts'

export const helpdeskFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, helpdeskRoutes)
