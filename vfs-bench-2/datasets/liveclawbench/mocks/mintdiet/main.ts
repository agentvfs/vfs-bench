/**
 * Serve the mintdiet fake: `tsx mocks/mintdiet/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `MINTDIET_URL=<url>` once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { mintdietFake } from './fake.ts'

await serve(mintdietFake)
