/**
 * Serve the chats fake: `tsx mocks/gaia2_chats/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { chatsFake } from './fake.ts'

await serve(chatsFake)
