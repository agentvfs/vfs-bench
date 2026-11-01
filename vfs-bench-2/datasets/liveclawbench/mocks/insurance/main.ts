/**
 * Serve the insurance fake: `tsx mocks/insurance/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `INSURANCE_URL=<url>` once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { insuranceFake } from './fake.ts'

await serve(insuranceFake)
