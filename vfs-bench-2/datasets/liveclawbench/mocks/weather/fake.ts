/**
 * The weather fake: LiveClawBench's weather mock on Mirage's integ kit.
 *
 * A run's world is its fixture's rows, keyed by upstream's table names;
 * every route reads it. Anything no route answers gets Hono's 404.
 */
import type { Dmmf, Fake } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { config } from './config.ts'
import type { C } from './config.ts'
import { Prisma, PrismaClient } from './client/index.js'
import { weatherRoutes } from './routes.ts'

const dmmf = Prisma.dmmf as unknown as Dmmf

export const weatherFake: Fake<C> = {
  config,
  client: PrismaClient,
  dmmf,
  // A fixture names each table as upstream does (`weather_daily`).
  seedRoots: Object.fromEntries(dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m.name])),
  routes: weatherRoutes,
}
