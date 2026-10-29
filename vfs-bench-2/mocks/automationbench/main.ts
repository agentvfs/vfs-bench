/**
 * Serve the AutomationBench fake: `tsx mocks/automationbench/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { automationbenchFake } from './fake.ts'

await serve(automationbenchFake)
