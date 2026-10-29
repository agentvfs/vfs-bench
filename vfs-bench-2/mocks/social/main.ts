/**
 * Serve the social fake: `tsx mocks/social/main.ts --port 0 --fixture-root
 * <dir> --fixture <name>`, announcing `SOCIAL_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { socialFake } from './fake.ts'

await serve(socialFake)
