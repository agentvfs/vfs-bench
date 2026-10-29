/**
 * The Gmail drafts fake: the drafts of Claw-Eval's gmail service on Mirage's
 * integ kit, for the one tool Mirage's gws fake has no counterpart of. A
 * run starts with no drafts and an empty audit log.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { gmailRoutes } from './routes.ts'

export const gmailFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, gmailRoutes)
