/**
 * The emails fake: gaia2-cli's `emails` app (apps/email.py, EmailClientV2)
 * on Mirage's integ kit. A run's mailbox is its scenario's.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { appConfig, appFake } from '../gaia2/store.ts'
import { commands } from './app.ts'
import { Prisma, PrismaClient } from './client/index.js'

export const config = appConfig('gaia2_emails', dirname(fileURLToPath(import.meta.url)))

export const emailsFake: Fake<PrismaClient> = appFake(
  config,
  PrismaClient,
  Prisma.dmmf as unknown as Dmmf,
  'gaia2_emails',
  'emails',
  'EmailClientV2',
  commands,
)
