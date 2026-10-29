/**
 * The chat fake's kit config, its client and where upstream's chat mock is.
 *
 * Upstream is LiveClawBench's chat mock (Mosi-AI/LiveClawBench @ 303dc77,
 * MIT, mock-platform/mocks/chat). This fake keeps its routes, request and
 * response JSON and its (absent) auth, on Mirage's integ kit: one SQLite
 * file per run, `/_run/<id>` routing, `/reset` and a frozen clock.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PrismaClient } from './client/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Mirage's integ package, whose kit and tools this fake runs on. */
export const INTEG = join(HERE, '..', '..', 'submodule', 'mirage', 'integ')

/** Upstream's chat mock, in the checkout `liveclawbench/setup.py` downloads. */
export const UPSTREAM =
  process.env.LIVECLAWBENCH_CHAT ?? join(HERE, '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform', 'mocks', 'chat')

/** The store's sticker art, which acquiring a pack copies. */
export const STORE_ASSETS = process.env.CHAT_STORE_ASSETS_DIR ?? join(UPSTREAM, 'static', 'store')

export const config = parseConfig({
  service: 'chat',
  schema: join(HERE, 'chat.prisma'),
  // One user's world per run, as upstream's mock is one user's.
  tenantKind: 'none',
})

/**
 * The run's client, which knows its own file: the pages render with
 * upstream's components, which read SQLite synchronously.
 */
export class ChatClient extends PrismaClient {
  readonly file: string

  constructor(options: { datasourceUrl: string }) {
    super(options)
    this.file = options.datasourceUrl.replace(/^file:/, '')
  }
}

export type C = ChatClient

/** The one user upstream seeds, who owns every channel and sticker. */
export const USER_ID = 1

/** Upstream's `MAX_FILE_SIZE` for an uploaded sticker. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024
