/**
 * The LightShop fake's kit config: ComplexMCP's LightShop
 * (software/LightShop/) on Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverConfig } from '../complexmcp/fake.ts'
import type { PrismaClient } from './client/index.js'

export const config = serverConfig('complexmcp_shop', dirname(fileURLToPath(import.meta.url)))

export type C = PrismaClient
