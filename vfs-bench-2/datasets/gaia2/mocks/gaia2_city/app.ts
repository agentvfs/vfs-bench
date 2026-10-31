/**
 * gaia2-cli's `city` app (apps/city.py), each command statement for
 * statement over the run's state. Its clock is the run's frozen epoch, as
 * upstream's is, so a rate limit once hit never cools down.
 */
import { CliError, get, num, type Command, type Py, type PyDict } from '../gaia2/store.ts'

export const APP_NAME = 'CityApp'
const COOLDOWN = 1800

/** `_load_crime_data`: each point as its dataclass, `CrimeDataPoint(**data)`. */
function crimeData(state: PyDict): Map<string, PyDict> {
  const out = new Map<string, PyDict>()
  for (const [zip, data] of Object.entries(get(state, 'crime_data', {}) as Record<string, PyDict>)) {
    out.set(zip, { violent_crime: data.violent_crime!, property_crime: data.property_crime! })
  }
  return out
}

const limitOf = (state: PyDict) => get(state, 'api_call_limit', 100) as number

export function commands(): Command[] {
  return [
    {
      name: 'get-crime-rate',
      async run(c) {
        const zip = c.str('zip_code')!
        const state = await c.state()
        const data = crimeData(state)
        const now = num(c.now())
        // _reset_rate_limit_if_expired
        let limitTime = get(state, 'rate_limit_time')
        if (limitTime !== null && now - num(limitTime) >= COOLDOWN) {
          state.rate_limit_time = null
          state.rate_limit_exceeded = false
        }
        // _is_rate_limited
        limitTime = get(state, 'rate_limit_time')
        const count = num(get(state, 'api_call_count', 0))
        const limited =
          (count >= limitOf(state) && limitTime === null) || (limitTime !== null && now - num(limitTime) < COOLDOWN)
        if (limited) {
          // _enforce_rate_limit
          if (get(state, 'rate_limit_time') === null) state.rate_limit_time = c.now()
          state.api_call_count = 0
          state.rate_limit_exceeded = true
          await c.save(state)
          throw new CliError(
            `Free version only supports ${limitOf(state)} API calls. Please try again after 30 minutes or upgrade to pro-version.`,
          )
        }
        state.api_call_count = num(get(state, 'api_call_count', 0)) + 1
        await c.save(state)
        if (!data.has(zip)) throw new CliError('Zip code does not exist in our database')
        const result = data.get(zip)!
        await c.log('get_crime_rate', { zip_code: zip }, result, false)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'get-api-call-count',
      async run(c) {
        const result = get(await c.state(), 'api_call_count', 0)
        await c.log('get_api_call_count', {}, result, false)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'get-api-call-limit',
      async run(c) {
        const result = limitOf(await c.state())
        await c.log('get_api_call_limit', {}, result, false)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'add-crime-rate',
      async run(c) {
        const zip = c.str('zip_code')!
        const violent = c.float('violent_crime_rate')!
        const property = c.float('property_crime_rate')!
        const state = await c.state()
        const data = crimeData(state)
        data.set(zip, { violent_crime: violent, property_crime: property })
        state.crime_data = Object.fromEntries(data) as Py
        await c.save(state)
        await c.log(
          'add_crime_rate',
          { zip_code: zip, violent_crime_rate: violent, property_crime_rate: property },
          'Added Successfully',
          true,
        )
        return { status: 'success', message: 'Added Successfully' }
      },
    },
    {
      name: 'update-crime-rate',
      async run(c) {
        const zip = c.str('zip_code')!
        const violent = c.float('new_violent_crime_rate')
        const property = c.float('new_property_crime_rate')
        if (violent === null && property === null) throw new CliError('No update provided')
        const state = await c.state()
        const data = crimeData(state)
        if (!data.has(zip)) throw new CliError('Zip code does not exist in our database')
        const point = data.get(zip)!
        if (violent !== null) point.violent_crime = violent
        if (property !== null) point.property_crime = property
        state.crime_data = Object.fromEntries(data) as Py
        await c.save(state)
        await c.log(
          'update_crime_rate',
          { zip_code: zip, new_violent_crime_rate: violent, new_property_crime_rate: property },
          'Updated Successfully',
          true,
        )
        return { status: 'success', message: 'Updated Successfully' }
      },
    },
  ]
}
