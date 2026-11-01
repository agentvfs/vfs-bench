/**
 * Serve the OCR fake: `tsx mocks/claweval_ocr/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { ocrFake } from './fake.ts'

await serve(ocrFake)
