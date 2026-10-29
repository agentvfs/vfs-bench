/**
 * The todo fake: Claw-Eval's todo service on Mirage's integ kit. A run's
 * tasks are its fixture's; its audit log and its lists of deleted, updated
 * and created tasks start empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { todoRoutes } from './routes.ts'

export const todoFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, todoRoutes)
