/**
 * The OCR fake: Claw-Eval's OCR service on Mirage's integ kit. A run's text
 * is the one its fixture holds, which upstream loads at start from the
 * task's OCR files; its call log starts empty.
 */
import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { ocrRoutes } from './routes.ts'

export const ocrFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, ocrRoutes)
