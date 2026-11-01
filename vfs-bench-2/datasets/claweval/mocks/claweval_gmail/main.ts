/**
 * Serve the Gmail drafts fake: `tsx mocks/claweval_gmail/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { gmailFake } from './fake.ts'

await serve(gmailFake)
