/**
 * Serve the config fake: `tsx mocks/claweval_config/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { configFake } from './fake.ts'

await serve(configFake)
