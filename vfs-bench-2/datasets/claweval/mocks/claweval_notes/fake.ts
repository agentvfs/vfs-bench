/**
 * The notes fake: Claw-Eval's notes service on Mirage's integ kit. A run's
 * notes are its fixture's, with the date it pins as upstream's `MOCK_TODAY`
 * where the task sets one; its audit log and its shares start empty.
 */
import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { notesRoutes } from './routes.ts'

export const notesFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, notesRoutes)
