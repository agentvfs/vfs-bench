/**
 * The web fake: Claw-Eval's web service on Mirage's integ kit. A run's
 * search results and pages are its fixture's; its audit log and its
 * notifications start empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { webRoutes } from './routes.ts'

export const webFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, webRoutes)
