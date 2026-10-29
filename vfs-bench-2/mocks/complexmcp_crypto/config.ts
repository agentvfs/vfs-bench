/**
 * The CryptoServer fake's kit config: ComplexMCP's CryptoServer
 * (`servers/crypto/app.py`) on Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverConfig } from '../complexmcp/fake.ts'
import type { PrismaClient } from './client/index.js'

export const config = serverConfig('complexmcp_crypto', dirname(fileURLToPath(import.meta.url)))

export type C = PrismaClient
