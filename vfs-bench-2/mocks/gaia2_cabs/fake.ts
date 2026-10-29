/**
 * The cabs fake: gaia2-cli's `cabs` app (apps/cab.py) on
 * Mirage's integ kit. A run's rides are its scenario's.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { appConfig, appFake } from '../gaia2/store.ts'
import { commands } from './app.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const config = appConfig('gaia2_cabs', dirname(fileURLToPath(import.meta.url)))

export const cabsFake: Fake<PrismaClient> = appFake(
  config,
  PrismaClient,
  Prisma.dmmf as unknown as Dmmf,
  'gaia2_cabs',
  'cabs',
  'CabApp',
  commands,
)
