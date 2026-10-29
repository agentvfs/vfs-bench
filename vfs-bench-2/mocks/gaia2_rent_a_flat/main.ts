/**
 * Serve the rent-a-flat fake: `tsx mocks/gaia2_rent_a_flat/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { rentAFlatFake } from './fake.ts'

await serve(rentAFlatFake)
