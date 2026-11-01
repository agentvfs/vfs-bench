/**
 * Serve the contacts fake: `tsx mocks/gaia2_contacts/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { contactsFake } from './fake.ts'

await serve(contactsFake)
