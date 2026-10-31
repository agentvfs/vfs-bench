/** The ERPBench fake's kit config and its client: the run's client knows its own file. */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverConfig } from '../enterpriseops/fake.ts'
import { PrismaClient } from './client/index.js'

export const config = serverConfig('erpbench', dirname(fileURLToPath(import.meta.url)))

export class ErpClient extends PrismaClient {
  readonly file: string

  constructor(options: { datasourceUrl: string }) {
    super(options)
    this.file = options.datasourceUrl.replace(/^file:/, '')
  }
}
