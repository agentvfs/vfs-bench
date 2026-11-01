/**
 * The finance fake: LiveClawBench's finance mock on Mirage's integ kit.
 *
 * Routes in upstream's order of registration: mock-lib's health check and
 * the probe, the pages, the API, then Hono's 404 for anything else. A run's
 * world is its fixture's rows, seeded by the kit (`/reset`), keyed by
 * upstream's table names; a reset also forgets the run's sessions and
 * faults, as a restarted mock would.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Dmmf, Fake, KitRoute } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { pageRoutes } from './pages.ts'
import { apiRoutes, openRoutes } from './routes.ts'
import { forget } from './session.ts'
import { notFound } from './wire.ts'

const dmmf = Prisma.dmmf as unknown as Dmmf

function routes(): KitRoute<C>[] {
  return [
    ...openRoutes(notFound),
    ...pageRoutes(),
    ...apiRoutes(),
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => route<C>(method, '/*rest', notFound)),
  ]
}

export const financeFake: Fake<C> = {
  config,
  client: PrismaClient,
  dmmf,
  // A fixture names each table as upstream does (`transaction_record`).
  seedRoots: Object.fromEntries(dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m.name])),
  afterReset: (db) => forget(db),
  routes,
}
