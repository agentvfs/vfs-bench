/**
 * Serve the messages fake: `tsx mocks/gaia2_messages/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { messagesFake } from './fake.ts'

await serve(messagesFake)
