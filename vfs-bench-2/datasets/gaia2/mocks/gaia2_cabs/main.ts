/**
 * Serve the cabs fake: `tsx mocks/gaia2_cabs/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { cabsFake } from './fake.ts'

await serve(cabsFake)
