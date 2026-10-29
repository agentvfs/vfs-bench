/**
 * Serve the LightStock fake: `tsx mocks/complexmcp_stock/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { fake } from './fake.ts'

await serve(fake)
