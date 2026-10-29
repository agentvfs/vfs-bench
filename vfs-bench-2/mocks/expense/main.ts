/**
 * Serve the expense fake: `tsx mocks/expense/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `EXPENSE_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { expenseFake } from './fake.ts'

await serve(expenseFake)
