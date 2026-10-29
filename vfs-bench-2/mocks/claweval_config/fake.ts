/**
 * The config fake: Claw-Eval's config service on Mirage's integ kit. A
 * run's integrations are its fixture's; its audit log, updates and
 * notifications start empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { configRoutes } from './routes.ts'

export const configFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, configRoutes)
