/**
 * Serve the knowledge base fake: `tsx mocks/claweval_kb/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { kbFake } from './fake.ts'

await serve(kbFake)
