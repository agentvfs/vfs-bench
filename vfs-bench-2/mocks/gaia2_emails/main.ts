/**
 * Serve the emails fake: `tsx mocks/gaia2_emails/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { emailsFake } from './fake.ts'

await serve(emailsFake)
