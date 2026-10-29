/**
 * Serve the scheduler fake: `tsx mocks/claweval_scheduler/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { schedulerFake } from './fake.ts'

await serve(schedulerFake)
