/**
 * Serve the shop fake: `tsx mocks/shop/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `SHOP_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { shopFake } from './fake.ts'

await serve(shopFake)
