/**
 * LightWeather (`software/LightWeather/weather.py`): the corpus's cities and
 * stations, each one's weather generated from the session's seed around
 * LightSystem's time at login, alerts and a primary location, and the app's
 * tools, statement for statement.
 */
import { type Os, clone, corpus, slice, uuid } from './common.ts'
import { F, type PyNum, add, div, formatDate, formatStamp, int, mul, num, parseDate, parseStamp, round, sub } from '../../../../workspace/py.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, failed, ok } from './tool.ts'

type Dict = Record<string, unknown>

export interface WeatherData {
  conditions: Record<string, Dict>
  cities: Record<string, Dict>
  stations: Record<string, Dict>
  climate_samples: Record<string, Dict>
  base_time: string
  alerts: Record<string, Dict>
  preferences: Dict
  current: Record<string, Dict>
  daily: Record<string, Dict[]>
  hourly: Record<string, Dict[]>
  precip: Record<string, Dict[]>
  uv: Record<string, Dict>
  aqi: Record<string, Dict>
  sun: Record<string, Dict>
  station_obs: Record<string, Dict>
  historical: Record<string, Dict[]>
  wind: Record<string, Dict[]>
  rng: RandomState
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const r1 = (x: PyNum) => round(F(num(x)), 1)

export class WeatherSession {
  d: WeatherData
  rng: PyRandom
  os: Os

  constructor(d: WeatherData, os: Os) {
    this.d = d
    this.rng = PyRandom.from(d.rng)
    this.os = os
  }

  /** `WeatherSession(seed, os_cfg)`. */
  static async create(seed: number, os: Os): Promise<WeatherSession> {
    const rng = new PyRandom(seed)
    type Info = { conditions?: Dict[]; advisories?: Dict[]; cities?: Dict[]; stations?: Dict[]; climate_samples?: Dict[] }
    const info = corpus<Info>('LightWeather', 'weather.yaml')
    const byKey = (list: Dict[] | undefined, key: string) => Object.fromEntries((list ?? []).map((x) => [String(x[key]), x]))
    const now = await os.now()
    const d: WeatherData = {
      conditions: byKey(info.conditions, 'id'),
      cities: byKey(info.cities, 'name'),
      stations: byKey(info.stations, 'id'),
      climate_samples: byKey(info.climate_samples, 'city'),
      base_time: now,
      alerts: {},
      preferences: {},
      current: {},
      daily: {},
      hourly: {},
      precip: {},
      uv: {},
      aqi: {},
      sun: {},
      station_obs: {},
      historical: {},
      wind: {},
      rng: [[], null],
    }
    const base = parseStamp(now)!
    const conditions = Object.values(d.conditions)
    for (const city of Object.keys(d.cities)) {
      const avg = (d.climate_samples[city]?.avg_temp ?? 15) as PyNum
      const cond = conditions.length > 0 ? rng.choice(conditions) : { id: 'unknown', name: 'Unknown' }
      const temp = r1(add(avg, F(rng.uniform(-8, 8))))
      const wind = r1(rng.uniform(0, 80))
      const humidity = r1(rng.uniform(20, 95))
      d.current[city] = { location: city, timestamp: now, condition: cond, temperature_c: temp, wind_kph: wind, humidity }
      d.daily[city] = []
      for (let i = 0; i < 7; i++) {
        const date = formatDate(base + i * DAY)
        const dcond = rng.choice(conditions)
        const dtemp = r1(add(avg, F(rng.uniform(-8, 8))))
        const precip = r1(Math.max(0.0, rng.gauss(3, 8)))
        d.daily[city]!.push({ date, condition: dcond, temp_c: dtemp, precip_mm: precip })
      }
      d.hourly[city] = []
      for (let h = 0; h < 48; h++) {
        const ts = formatStamp(base + h * HOUR)
        const hcond = rng.choice(conditions)
        const htemp = r1(add(avg, F(rng.uniform(-6, 6))))
        const pprob = round(F(rng.uniform(0, 1)), 2)
        d.hourly[city]!.push({ timestamp: ts, condition: hcond, temp_c: htemp, precip_prob: pprob })
      }
      d.precip[city] = []
      for (let h = 0; h < 24; h++) d.precip[city]!.push({ hour_offset: h, prob: round(F(rng.uniform(0, 1)), 2) })
      const uvv = r1(rng.uniform(0, 11))
      const u = num(uvv)
      d.uv[city] = { uv: uvv, level: u < 3 ? 'low' : u < 6 ? 'moderate' : u < 8 ? 'high' : 'very high' }
      const aqi = int(Math.max(0, Math.min(500, int(rng.gauss(50, 60)))))
      d.aqi[city] = { aqi, category: aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 200 ? 'Unhealthy' : 'Very Unhealthy' }
      d.sun[city] = { sunrise: formatStamp(base + 6 * HOUR), sunset: formatStamp(base + 18 * HOUR) }
      d.historical[city] = []
      for (let i = 0; i < 30; i++) {
        const date = formatDate(base - i * DAY)
        const temp = r1(add(avg, F(rng.uniform(-10, 10))))
        d.historical[city]!.push({ date, temp_c: temp, condition: rng.choice(conditions) })
      }
      d.wind[city] = []
      for (let i = 0; i < 24 * 7; i++) {
        const speed = r1(rng.uniform(0, 100))
        d.wind[city]!.push({ hour_offset: i + 1, speed_kph: speed, gust_kph: r1(rng.uniform(0, 140)) })
      }
    }
    for (const sid of Object.keys(d.stations)) {
      const temperature = r1(10 + rng.uniform(-10, 15))
      const humidity = r1(rng.uniform(10, 95))
      const wind = r1(rng.uniform(0, 80))
      const pressure = r1(1000 + rng.uniform(-30, 30))
      d.station_obs[sid] = { timestamp: now, temperature_c: temperature, humidity, wind_kph: wind, pressure_hpa: pressure, status: rng.choice(['online', 'offline', 'maintenance']) }
    }
    d.rng = rng.getstate()
    return new WeatherSession(d, os)
  }

  data(): WeatherData {
    return { ...this.d, rng: this.rng.getstate() }
  }
}

const notFound = (location: string) => failed(`Location ${location} not found`)

const tools: Tools<WeatherSession> = {
  list_cities: { params: [], run: async (s) => ok(Object.keys(s.d.cities)) },
  get_current_weather: {
    params: [['location', 'str']],
    run: async (s, { location }) => {
      const w = s.d.current[location]
      if (!w) return notFound(location)
      try {
        return ok({ ...w, timestamp: await s.os.now() })
      } catch {
        return ok(w)
      }
    },
  },
  get_forecast: {
    params: [['location', 'str'], ['days', 'int']],
    run: async (s, { location, days }) => (location in s.d.daily ? ok(slice(s.d.daily[location]!, 0, days)) : notFound(location)),
  },
  get_hourly_forecast: {
    params: [['location', 'str'], ['hours', 'int']],
    run: async (s, { location, hours }) => (location in s.d.hourly ? ok(slice(s.d.hourly[location]!, 0, hours)) : notFound(location)),
  },
  list_stations: { params: [], run: async (s) => ok(Object.values(s.d.stations)) },
  get_station_info: {
    params: [['station_id', 'str']],
    run: async (s, { station_id }) => {
      const st = s.d.stations[station_id]
      if (!st) return failed(`Station ${station_id} not found`)
      return ok({ ...st, status: s.d.station_obs[station_id]?.status ?? 'unknown' })
    },
  },
  get_station_observation: {
    params: [['station_id', 'str']],
    run: async (s, { station_id }) => {
      const obs = s.d.station_obs[station_id]
      if (!obs) return failed(`Station ${station_id} not found`)
      try {
        return ok({ ...obs, timestamp: await s.os.now() })
      } catch {
        return ok(obs)
      }
    },
  },
  get_historical_weather: {
    params: [['location', 'str'], ['start', 'str'], ['end', 'str']],
    run: async (s, { location, start, end }) => {
      if (!(location in s.d.historical)) return notFound(location)
      const a = parseDate(start)
      const b = parseDate(end)
      if (a === null || b === null) return failed('Invalid date format. Use YYYY-MM-DD.')
      if (a > b) return failed('Start date must be before end date.')
      return ok(s.d.historical[location]!.filter((e) => {
        const t = parseDate(e.date as string)!
        return a <= t && t <= b
      }))
    },
  },
  get_weather_alerts: {
    params: [['location', 'str']],
    run: async (s, { location }) => ok(Object.values(s.d.alerts).filter((a) => a.location === location)),
  },
  create_alert: {
    params: [['location', 'str'], ['condition', 'str'], ['threshold', 'float']],
    run: async (s, { location, condition, threshold }) => {
      if (!(location in s.d.cities)) return notFound(location)
      const aid = `alert_${uuid(s.rng, 12)}`
      const alert = { aid, location, condition, threshold, timestamp: await s.os.now() }
      s.d.alerts[aid] = alert
      return ok(clone(alert))
    },
  },
  delete_alert: {
    params: [['alert_id', 'str']],
    run: async (s, { alert_id }) => {
      if (!(alert_id in s.d.alerts)) return failed(`Alert ${alert_id} not found`)
      delete s.d.alerts[alert_id]
      return ok(`Alert ${alert_id} deleted`)
    },
  },
  list_alerts: { params: [], run: async (s) => ok(Object.values(s.d.alerts)) },
  get_uv_index: {
    params: [['location', 'str']],
    run: async (s, { location }) => (location in s.d.uv ? ok(s.d.uv[location]) : notFound(location)),
  },
  get_air_quality: {
    params: [['location', 'str']],
    run: async (s, { location }) => (location in s.d.aqi ? ok(s.d.aqi[location]) : notFound(location)),
  },
  get_sun_times: {
    params: [['location', 'str']],
    run: async (s, { location }) => (location in s.d.sun ? ok(s.d.sun[location]) : notFound(location)),
  },
  convert_temperature: {
    params: [['value', 'float'], ['from_unit', 'str'], ['to_unit', 'str']],
    run: async (_s, { value, from_unit, to_unit }) => {
      const fu = (from_unit as string).toLowerCase()
      const tu = (to_unit as string).toLowerCase()
      if (fu === tu) return ok(value)
      const c: PyNum = fu === 'f' ? div(mul(sub(value, 32), F(5.0)), F(9.0)) : fu === 'k' ? sub(value, F(273.15)) : value
      const out: PyNum = tu === 'f' ? add(div(mul(c, F(9.0)), F(5.0)), 32) : tu === 'k' ? add(c, F(273.15)) : c
      return ok(round(out, 2))
    },
  },
  estimate_travel_weather: {
    params: [['route', 'list[str]']],
    run: async (s, { route }) =>
      ok((route as string[]).map((loc) => (loc in s.d.cities ? { location: loc, weather: s.d.current[loc] ?? null } : { location: loc, status: 'unknown' }))),
  },
  compare_climate: {
    params: [['location1', 'str'], ['location2', 'str']],
    run: async (s, { location1, location2 }) => {
      const c1 = s.d.climate_samples[location1]
      const c2 = s.d.climate_samples[location2]
      if (!c1 || !c2) return failed('One or both locations not found in climate samples')
      return ok({
        temp_diff: sub(c1.avg_temp as PyNum, c2.avg_temp as PyNum),
        rain_diff_mm: sub(c1.rainfall_mm as PyNum, c2.rainfall_mm as PyNum),
      })
    },
  },
  get_precip_probability: {
    params: [['location', 'str'], ['next_hours', 'int']],
    run: async (s, { location, next_hours }) => (location in s.d.precip ? ok(slice(s.d.precip[location]!, 0, next_hours)) : notFound(location)),
  },
  get_wind_forecast: {
    params: [['location', 'str'], ['hours', 'int']],
    // Upstream returns the list itself here, not a status and output.
    run: async (s, { location, hours }) => (location in s.d.wind ? slice(s.d.wind[location]!, 0, hours) : notFound(location)),
  },
  get_climate_summary: {
    params: [['location', 'str'], ['year', 'int']],
    run: async (s, { location, year }) => {
      if (!(location in s.d.cities)) return notFound(location)
      const sample = s.d.climate_samples[location] ?? {}
      return ok({ year, avg_temp: sample.avg_temp ?? 15, annual_rainfall_mm: sample.rainfall_mm ?? 800 })
    },
  },
  set_primary_location: {
    params: [['location', 'str']],
    run: async (s, { location }) => {
      if (!(location in s.d.cities)) return notFound(location)
      s.d.preferences.primary_location = location
      return ok(`Primary location set to ${location}`)
    },
  },
  get_primary_location: { params: [], run: async (s) => ok(s.d.preferences.primary_location ?? null) },
}

export const LightWeather: App<WeatherSession, WeatherData> = {
  name: 'LightWeather',
  tools,
  load: (data, os) => new WeatherSession(data, os),
  save: (s) => s.data(),
  // Upstream's login and logout answer an empty environment, not the
  // session's `get_session_dict()`.
  sessionDict: () => ({}),
}
