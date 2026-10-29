/**
 * The chat fake: LiveClawBench's chat mock on Mirage's integ kit.
 *
 * Routes in upstream's order of precedence: the API, the static files, the
 * pages, then Hono's 404 for anything else. Nothing is authenticated, as
 * upstream's mock is not. A run's world is its fixture's rows, seeded by
 * the kit (`/reset`), keyed by upstream's table names.
 */
import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Dmmf, Fake, KitRoute } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { ChatClient, config } from './config.ts'
import type { C } from './config.ts'
import { Prisma } from './client/index.js'
import { pages } from './pages.ts'
import { apiRoutes, staticRoutes } from './routes.ts'
import { notFound } from './wire.ts'

const dmmf = Prisma.dmmf as unknown as Dmmf

function routes(): KitRoute<C>[] {
  return [
    ...apiRoutes(),
    ...staticRoutes(notFound),
    route<C>('GET', '/', pages.root),
    route<C>('GET', '/store', pages.store),
    route<C>('GET', '/chat', pages.chat),
    route<C>('GET', '/stickers', pages.stickers),
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => route<C>(method, '/*rest', notFound)),
  ]
}

export const chatFake: Fake<C> = {
  config,
  client: ChatClient,
  dmmf,
  // A fixture names each table as upstream does (`user_sticker`).
  seedRoots: Object.fromEntries(dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m.name])),
  routes,
}
