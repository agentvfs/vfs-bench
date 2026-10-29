/**
 * Serve the web fake: `tsx mocks/claweval_web/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { webFake } from './fake.ts'

await serve(webFake)
