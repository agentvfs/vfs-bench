/**
 * Serve the airline fake: `tsx mocks/airline/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `AIRLINE_URL=<url>` once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { airlineFake } from './fake.ts'

await serve(airlineFake)
