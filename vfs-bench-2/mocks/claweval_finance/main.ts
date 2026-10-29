/**
 * Serve the finance fake: `tsx mocks/claweval_finance/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { financeFake } from './fake.ts'

await serve(financeFake)
