/**
 * Serve the todolist fake: `tsx mocks/todolist/main.ts --port 0 --fixture-root <dir>
 * --fixture <name>`, announcing `TODOLIST_URL=<url>` once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { todolistFake } from './fake.ts'

await serve(todolistFake)
