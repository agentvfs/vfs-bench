/**
 * The inventory fake: Claw-Eval's inventory service on Mirage's integ kit.
 * A run's products are its fixture's; its audit log and orders start empty.
 */
import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceFake } from '../claweval/store.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { inventoryRoutes } from './routes.ts'

export const inventoryFake: Fake<C> = serviceFake(config, PrismaClient, Prisma.dmmf as unknown as Dmmf, inventoryRoutes)
