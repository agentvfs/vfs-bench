/**
 * The chats fake: gaia2-cli's `chats` app (apps/chats.py) on Mirage's
 * integ kit. A run's conversations are its scenario's.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { appConfig, appFake } from '../gaia2/store.ts'
import { APP_NAME, commands } from './app.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const config = appConfig('gaia2_chats', dirname(fileURLToPath(import.meta.url)))

export const chatsFake: Fake<PrismaClient> = appFake(
  config,
  PrismaClient,
  Prisma.dmmf as unknown as Dmmf,
  'gaia2_chats',
  'chats',
  APP_NAME,
  commands,
)
