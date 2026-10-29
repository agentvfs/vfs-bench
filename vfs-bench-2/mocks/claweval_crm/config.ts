/**
 * The CRM fake's kit config: Claw-Eval's crm service
 * (mock_services/crm/server.py) on Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serviceConfig } from '../claweval/store.ts'
import type { PrismaClient } from './client/index.js'

export const config = serviceConfig('claweval_crm', dirname(fileURLToPath(import.meta.url)))

export type C = PrismaClient
