/**
 * The shopping fake: gaia2-cli's `shopping` app (apps/shopping.py) on
 * Mirage's integ kit. A run's catalog, cart and orders are its scenario's.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { appConfig, appFake } from '../gaia2/store.ts'
import { commands } from './app.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const config = appConfig('gaia2_shopping', dirname(fileURLToPath(import.meta.url)))

export const shoppingFake: Fake<PrismaClient> = appFake(
  config,
  PrismaClient,
  Prisma.dmmf as unknown as Dmmf,
  'gaia2_shopping',
  'shopping',
  'Shopping',
  commands,
)
