/**
 * Serve the calendar fake: `tsx mocks/gaia2_calendar/main.ts --port 0
 * --fixture-root <dir> --fixture <name>`, announcing its URL once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { calendarFake } from './fake.ts'

await serve(calendarFake)
