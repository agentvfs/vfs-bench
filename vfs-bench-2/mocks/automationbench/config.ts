/**
 * The AutomationBench fake's kit config: one service, a run per task.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

export const config = parseConfig({ service: 'automationbench', schema: join(HERE, 'automationbench.prisma'), tenantKind: 'none' })
