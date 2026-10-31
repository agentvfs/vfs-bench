/**
 * The workspace fake: LiveClawBench's workspace mock, upstream's own app, on Mirage's
 * integ kit (mocks/upstream/fake.ts).
 */
import type { Dmmf } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { serviceSpec, upstreamFake } from '../upstream/fake.ts'
import { Prisma } from './client/index.js'
import { WorkspaceClient, config } from './config.ts'

export const workspaceFake = upstreamFake(serviceSpec('workspace'), config, WorkspaceClient, Prisma.dmmf as unknown as Dmmf)
