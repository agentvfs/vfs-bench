/**
 * The CSM fake's kit config and its client: EnterpriseOps-Gym's
 * `sn-csm-server` on Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverConfig } from '../enterpriseops/fake.ts'
import { PrismaClient } from './client/index.js'

export const config = serverConfig('enterpriseops_csm', dirname(fileURLToPath(import.meta.url)))

/** The run's client, which knows its own file: the tools run their SQL on it. */
export class CsmClient extends PrismaClient {
  readonly file: string

  constructor(options: { datasourceUrl: string }) {
    super(options)
    this.file = options.datasourceUrl.replace(/^file:/, '')
  }
}
