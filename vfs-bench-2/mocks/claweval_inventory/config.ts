/**
 * The inventory fake's kit config: Claw-Eval's inventory service
 * (mock_services/inventory/server.py) on Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serviceConfig } from '../claweval/store.ts'
import type { PrismaClient } from './client/index.js'

export const config = serviceConfig('claweval_inventory', dirname(fileURLToPath(import.meta.url)))

export type C = PrismaClient
