/**
 * Serve the helpdesk fake: `tsx mocks/claweval_helpdesk/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { helpdeskFake } from './fake.ts'

await serve(helpdeskFake)
