/**
 * Serve the notes fake: `tsx mocks/claweval_notes/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { notesFake } from './fake.ts'

await serve(notesFake)
