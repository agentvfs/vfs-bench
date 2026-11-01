/**
 * Serve the todo fake: `tsx mocks/claweval_todo/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { todoFake } from './fake.ts'

await serve(todoFake)
