/**
 * Serve the weather fake: `tsx mocks/weather/main.ts --port 0 --fixture-root
 * <dir> --fixture <name>`, announcing `WEATHER_URL=<url>` once it listens.
 */
import { serve } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { weatherFake } from './fake.ts'

await serve(weatherFake)
