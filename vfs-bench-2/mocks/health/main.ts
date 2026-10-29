/**
 * Serve the health fake: `tsx mocks/health/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `HEALTH_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { healthFake } from './fake.ts'

await serve(healthFake)
