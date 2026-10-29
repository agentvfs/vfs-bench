/**
 * The contacts fake: Claw-Eval's contacts service on Mirage's integ kit. A
 * run's contacts are its fixture's; its audit log and its sent messages
 * start empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { contactsRoutes } from './routes.ts'

export const contactsFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, contactsRoutes)
