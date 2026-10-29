/**
 * Serve the CRM fake: `tsx mocks/claweval_crm/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { crmFake } from './fake.ts'

await serve(crmFake)
