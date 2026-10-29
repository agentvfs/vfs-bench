/**
 * Serve the inventory fake: `tsx mocks/claweval_inventory/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { inventoryFake } from './fake.ts'

await serve(inventoryFake)
