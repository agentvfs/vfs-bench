/**
 * Serve the shopping fake: `tsx mocks/gaia2_shopping/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { shoppingFake } from './fake.ts'

await serve(shoppingFake)
