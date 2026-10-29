/**
 * Serve the rss fake: `tsx mocks/claweval_rss/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { rssFake } from './fake.ts'

await serve(rssFake)
