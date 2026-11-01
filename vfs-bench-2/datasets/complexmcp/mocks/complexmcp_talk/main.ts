/**
 * Serve the LightTalk fake: `tsx mocks/complexmcp_talk/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { fake } from './fake.ts'

await serve(fake)
