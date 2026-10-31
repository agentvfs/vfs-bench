/**
 * Serve the workspace fake: `tsx mocks/workspace/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `WORKSPACE_URL=<url>` once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { workspaceFake } from './fake.ts'

await serve(workspaceFake)
