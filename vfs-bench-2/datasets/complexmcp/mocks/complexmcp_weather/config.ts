/**
 * The LightWeather fake's kit config: ComplexMCP's LightWeather
 * (software/LightWeather/) on Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverConfig } from '../complexmcp/fake.ts'
import type { PrismaClient } from './client/index.js'

export const config = serverConfig('complexmcp_weather', dirname(fileURLToPath(import.meta.url)))

export type C = PrismaClient
