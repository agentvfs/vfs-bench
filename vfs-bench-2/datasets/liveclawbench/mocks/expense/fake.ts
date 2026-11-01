/**
 * The expense fake: LiveClawBench's expense mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { ExpenseClient, config } from './config.ts'

export const expenseFake = upstreamFake(serviceSpec('expense'), config, ExpenseClient, Prisma.dmmf as unknown as Dmmf)
