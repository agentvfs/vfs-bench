/**
 * The rss fake: Claw-Eval's rss service on Mirage's integ kit. A run's
 * articles are its fixture's; its audit log and published newsletters start
 * empty.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { rssRoutes } from './routes.ts'

export const rssFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, rssRoutes)
