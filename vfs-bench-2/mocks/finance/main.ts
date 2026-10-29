/**
 * Serve the finance fake: `tsx mocks/finance/main.ts --port 0 --fixture-root
 * <dir> --fixture <name>`, announcing `FINANCE_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { financeFake } from './fake.ts'

await serve(financeFake)
