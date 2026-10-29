/**
 * Serve the chat fake: `tsx mocks/chat/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `CHAT_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { chatFake } from './fake.ts'

await serve(chatFake)
