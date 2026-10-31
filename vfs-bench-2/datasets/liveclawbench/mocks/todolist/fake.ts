/**
 * The todolist fake: LiveClawBench's todolist mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { TodolistClient, config } from './config.ts'

export const todolistFake = upstreamFake(serviceSpec('todolist'), config, TodolistClient, Prisma.dmmf as unknown as Dmmf)
