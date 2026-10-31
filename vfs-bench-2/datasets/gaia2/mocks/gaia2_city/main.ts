/**
 * Serve the city fake: `tsx mocks/gaia2_city/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { cityFake } from './fake.ts'

await serve(cityFake)
