/**
 * Serve the smarthome fake: `tsx mocks/smarthome/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `SMARTHOME_URL=<url>` once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { smarthomeFake } from './fake.ts'

await serve(smarthomeFake)
