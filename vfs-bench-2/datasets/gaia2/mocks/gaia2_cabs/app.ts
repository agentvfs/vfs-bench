/**
 * gaia2-cli's `cabs` app (apps/cab.py), each command statement for statement
 * over the run's state. Prices, distances, delays and ride ids come from md5
 * hashes of the ride's fields, as upstream's do, with its arithmetic: the
 * 128-bit hash as a BigInt, each value an int or a float as Python has it.
 */
import { createHash } from 'node:crypto'

import { CliError, PyError, PyFloat, UsageError, copy, floatRepr, get, isFloat, num, pf, slice, str, valueError } from '../gaia2/store.ts'
import type { Call, Command, Py, PyDict } from '../gaia2/store.ts'

const APP_NAME = 'CabApp'
export { APP_NAME }

const DEFAULT_SERVICE_CONFIG: PyDict = {
  Default: { nb_seats: 4, price_per_km: new PyFloat(1), base_delay_min: 5, max_distance_km: 25 },
  Premium: { nb_seats: 4, price_per_km: new PyFloat(2), base_delay_min: 3, max_distance_km: 25 },
  Van: { nb_seats: 6, price_per_km: 1.5, base_delay_min: 7, max_distance_km: 25 },
}

/** The `Ride` dataclass's fields, in order. */
const RIDE_FIELDS = [
  'ride_id',
  'status',
  'service_type',
  'start_location',
  'end_location',
  'price',
  'duration',
  'time_stamp',
  'distance_km',
  'delay',
  'delay_history',
] as const

/** A `Ride`: its fields as Python values. */
type Ride = PyDict

/** `Ride(**kwargs)`: the defaults, then the given fields. */
function newRide(given: PyDict): Ride {
  const ride: Ride = {
    ride_id: '',
    status: null,
    service_type: null,
    start_location: null,
    end_location: null,
    price: null,
    duration: null,
    time_stamp: null,
    distance_km: null,
    delay: null,
    delay_history: [],
  }
  for (const [k, v] of Object.entries(given)) ride[k] = v
  return ride
}

/** `_filter_ride`. */
const filterRide = (raw: PyDict): Ride =>
  newRide(Object.fromEntries(Object.entries(raw).filter(([k]) => (RIDE_FIELDS as readonly string[]).includes(k))))

/** `_load_rides`. */
const loadRides = (raw: Py): Ride[] => (raw as PyDict[]).map(filterRide)

/** `dataclasses.asdict(ride)`: a deep copy in field order. */
const asdict = (ride: Ride): PyDict => Object.fromEntries(RIDE_FIELDS.map((k) => [k, copy(ride[k]!)]))

/** `_build_full_state`. */
function buildFullState(rideHistory: Ride[], quotationHistory: Ride[], config: PyDict, onGoing: Ride | null): PyDict {
  return {
    ride_history: rideHistory.map(asdict),
    quotation_history: quotationHistory.map(asdict),
    d_service_config: config,
    on_going_ride: onGoing === null ? null : asdict(onGoing),
  }
}

/** Each command's view of the state, as upstream's opening lines load it. */
function loadAll(state: PyDict) {
  const raw = get(state, 'on_going_ride')
  return {
    rideHistory: loadRides(get(state, 'ride_history', [])),
    quotationHistory: loadRides(get(state, 'quotation_history', [])),
    config: get(state, 'd_service_config', DEFAULT_SERVICE_CONFIG) as PyDict,
    onGoing: truthyDict(raw) ? filterRide(raw as PyDict) : null,
  }
}

const truthyDict = (v: Py): boolean => v !== null && typeof v === 'object' && !(v instanceof PyFloat) && Object.keys(v).length > 0

// --- Python arithmetic -------------------------------------------------------

/** `a + b`, `a * b`, `a - b` on Python ints and floats: a float if either is. */
const arith = (a: Py, b: Py, f: (x: number, y: number) => number): number | PyFloat => {
  const v = f(num(a), num(b))
  return isFloat(a) || isFloat(b) ? pf(v) : v
}
const add = (a: Py, b: Py) => arith(a, b, (x, y) => x + y)
const mul = (a: Py, b: Py) => arith(a, b, (x, y) => x * y)
const sub = (a: Py, b: Py) => arith(a, b, (x, y) => x - y)

/** `f"{x}"` for a number. */
const fmt = (x: Py): string => (isFloat(x) ? floatRepr(num(x)) : String(num(x)))

/** `int(hashlib.md5(text.encode()).hexdigest(), 16)`. */
const md5 = (text: string): bigint => BigInt(`0x${createHash('md5').update(text, 'utf8').digest('hex')}`)

/** `(h % n)` as a number. */
const mod = (h: bigint, n: number): number => Number(h % BigInt(n))

/** `a > b` as Python compares numbers; anything else is a TypeError. */
function greater(a: Py, b: Py): boolean {
  const kind = (v: Py) => (v === null ? 'NoneType' : typeof v === 'string' ? 'str' : isFloat(v) ? 'float' : typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'int' : Array.isArray(v) ? 'list' : 'dict')
  const numeric = (v: Py) => typeof v === 'number' || typeof v === 'boolean' || v instanceof PyFloat
  if (!numeric(a) || !numeric(b)) {
    throw new PyError('TypeError', `'>' not supported between instances of '${kind(a)}' and '${kind(b)}'`)
  }
  return Number(num(a)) > Number(num(b))
}

// --- datetime ----------------------------------------------------------------

/** `str.isspace()`'s characters, which `\s` matches in Python's `re`. */
const WS = '[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const D = '\\p{Nd}'
/** `_strptime`'s regex for `%Y-%m-%d %H:%M:%S` (a run of whitespace for the space), matched from the start. */
const RIDE_TIME = new RegExp(
  `^(?<Y>${D}${D}${D}${D})-(?<m>1[0-2]|0[1-9]|[1-9])-(?<d>3[0-1]|[1-2]${D}|0[1-9]|[1-9]| [1-9])${WS}+` +
    `(?<H>2[0-3]|[0-1]${D}|${D}):(?<M>[0-5]${D}|${D}):(?<S>6[0-1]|[0-5]${D}|${D})`,
  'iu',
)
const ND = /\p{Nd}/u

/** `int(digits)` for any Unicode decimal digits, as Python reads them. */
function int(digits: string): number {
  let n = 0
  for (const ch of digits) {
    let cp = ch.codePointAt(0)!
    let start = cp
    while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--
    cp = (cp - start) % 10
    n = n * 10 + cp
  }
  return n
}

/** Days since 1970-01-01 of a proleptic Gregorian date. */
function days(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** `datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=utc).timestamp()`, or null on its ValueError. */
function strptimeTs(text: string): number | null {
  const found = RIDE_TIME.exec(text)
  if (found === null || found[0].length !== text.length) return null
  const g = found.groups!
  const [y, m, d, hh, mm, ss] = [g.Y!, g.m!, g.d!, g.H!, g.M!, g.S!].map((x) => int(x.trim()))
  if (y! < 1) return null
  if (d! > (m === 2 && leap(y!) ? 29 : MONTH_DAYS[m! - 1]!)) return null
  if (ss! > 59) return null
  return days(y!, m!, d!) * 86400 + hh! * 3600 + mm! * 60 + ss!
}

/** `datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")`. */
function strftimeUtc(t: number): string {
  let whole = Math.floor(t)
  const frac = t - whole
  // fromtimestamp rounds to microseconds, half to even.
  const scaled = frac * 1e6
  let us = Math.round(scaled)
  if (Math.abs(scaled % 1) === 0.5 && us % 2 !== 0) us -= 1
  if (us >= 1000000) whole += 1
  const day = Math.floor(whole / 86400)
  const secs = whole - day * 86400
  const date = new Date(0)
  date.setUTCFullYear(1970, 0, 1 + day)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${p(date.getUTCFullYear(), 4)}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(Math.floor(secs / 3600))}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}`
  )
}

/** `_parse_ride_time`: the ride time's text and its timestamp (a float). */
function parseRideTime(c: Call, rideTime: string | null): [string, number | PyFloat] {
  if (rideTime === null) rideTime = strftimeUtc(num(c.now()))
  const ts = strptimeTs(rideTime)
  if (ts === null) throw valueError('Invalid datetime format for the ride time. Please use YYYY-MM-DD HH:MM:SS')
  return [rideTime, pf(ts)]
}

// --- quotations ----------------------------------------------------------------

/** `_deterministic_distance`. */
const deterministicDistance = (start: string, end: string) => pf(mod(md5(start + end), 1500) / 100.0 + 5.0)

/** `_calculate_distance`. */
function calculateDistance(start: string, end: string, quotations: Ride[]): Py {
  for (const ride of quotations) {
    if (ride.start_location === start && ride.end_location === end) return ride.distance_km!
  }
  return deterministicDistance(start, end)
}

/** `_calculate_price`. */
function calculatePrice(start: string, end: string, distance: Py, service: string, ts: Py, quotations: Ride[], config: PyDict): Py {
  let prev: Ride | null = null
  for (const ride of quotations) {
    if (ride.start_location === start && ride.end_location === end && ride.service_type === service) {
      prev = ride
      break
    }
  }
  if (prev !== null && truthyNum(prev.price!)) {
    let variance = (0.01 * (num(ts) - num(prev.time_stamp)!)) / 3600
    variance = Math.min(Math.max(variance, 0.5), 1.5)
    const h = md5(`${start}${end}${service}${fmt(ts)}`)
    const factor = (mod(h, 2000) / 1000.0 - 1.0) * variance
    return pf(num(prev.price) * (1 + factor))
  }
  return mul(distance, (config[service] as PyDict).price_per_km!)
}

const truthyNum = (v: Py) => v !== null && v !== false && v !== '' && num(v) !== 0

/** `_get_quotation`: the quotation, appended to the history. */
function getQuotation(c: Call, start: string, end: string, service: string, rideTime: string | null, quotations: Ride[], config: PyDict): Ride {
  const [, ts] = parseRideTime(c, rideTime)
  if (!Object.hasOwn(config, service)) throw valueError('Invalid service type.')
  const svc = config[service] as PyDict
  const distance = calculateDistance(start, end, quotations)
  if (greater(distance, svc.max_distance_km!)) throw valueError('Distance exceeds maximum allowed.')
  const price = calculatePrice(start, end, distance, service, ts, quotations, config)
  const baseDelay = svc.base_delay_min!
  const h = md5(`delay${start}${end}${service}${fmt(ts)}`)
  const delay = add(add(baseDelay, mod(h, 5)), 1)
  const h2 = md5(`dur${start}${end}${fmt(ts)}`)
  const duration = pf((num(distance) / 50) * 60 + mod(h2, 1000) / 100.0)
  const rideId = createHash('md5').update(`${start}${end}${service}${fmt(ts)}`, 'utf8').digest('hex')
  const ride = newRide({
    ride_id: rideId,
    service_type: service,
    start_location: start,
    end_location: end,
    price,
    duration,
    time_stamp: ts,
    distance_km: distance,
    delay,
  })
  quotations.push(ride)
  return ride
}

/** A required option: click's usage error where it is missing. */
function required(c: Call, name: string): string {
  const v = c.str(name)
  if (v === null) throw new UsageError(`Missing option '--${name.replace(/_/g, '-')}'.`)
  return v
}

/** Re-throw a caught ValueError as `cli_error(str(e))`. */
function asCliError(error: unknown): never {
  if (error instanceof PyError && error.type === 'ValueError') throw new CliError(str(error))
  throw error
}

export function commands(): Command[] {
  return [
    {
      name: 'get-quotation',
      async run(c) {
        const start = required(c, 'start_location')
        const end = required(c, 'end_location')
        const service = required(c, 'service_type')
        const rideTime = c.str('ride_time')
        const { rideHistory, quotationHistory, config, onGoing } = loadAll(await c.state())
        const eventArgs = { start_location: start, end_location: end, service_type: service, ride_time: rideTime }
        let ride: Ride
        try {
          ride = getQuotation(c, start, end, service, rideTime, quotationHistory, config)
        } catch (error) {
          asCliError(error)
        }
        await c.save(buildFullState(rideHistory, quotationHistory, config, onGoing))
        const result = asdict(ride)
        await c.log('get_quotation', eventArgs, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'list-rides',
      async run(c) {
        const start = required(c, 'start_location')
        const end = required(c, 'end_location')
        const rideTime = c.str('ride_time')
        const { rideHistory, quotationHistory, config, onGoing } = loadAll(await c.state())
        const [rideTimeStr] = parseRideTime(c, rideTime)
        const eventArgs = { start_location: start, end_location: end, ride_time: rideTime }
        const allRides: Ride[] = []
        try {
          for (const svc of Object.keys(config)) {
            allRides.push(getQuotation(c, start, end, svc, rideTimeStr, quotationHistory, config))
          }
        } catch (error) {
          asCliError(error)
        }
        await c.save(buildFullState(rideHistory, quotationHistory, config, onGoing))
        const result = allRides.map(asdict)
        await c.log('list_rides', eventArgs, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'order-ride',
      async run(c) {
        const start = required(c, 'start_location')
        const end = required(c, 'end_location')
        const service = required(c, 'service_type')
        const rideTime = c.str('ride_time')
        const { rideHistory, quotationHistory, config, onGoing } = loadAll(await c.state())
        const eventArgs = { start_location: start, end_location: end, service_type: service, ride_time: rideTime }
        if (onGoing !== null) throw new CliError('You have an on-going ride.')
        const [rideTimeStr] = parseRideTime(c, rideTime)
        let ride: Ride
        try {
          ride = getQuotation(c, start, end, service, rideTimeStr, quotationHistory, config)
        } catch (error) {
          asCliError(error)
        }
        // The ride is the quotation's object too, as upstream's is.
        ride.status = 'BOOKED'
        ;(ride.delay_history as Py[]).push({ delay: ride.delay!, time_stamp: ride.time_stamp! })
        rideHistory.push(ride)
        await c.save(buildFullState(rideHistory, quotationHistory, config, ride))
        const result = asdict(ride)
        const userResult = Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'delay' && k !== 'delay_history'))
        await c.log('order_ride', eventArgs, userResult, true)
        return { status: 'success', data: userResult }
      },
    },
    {
      name: 'user-cancel-ride',
      async run(c) {
        const { rideHistory, quotationHistory, config, onGoing } = loadAll(await c.state())
        if (onGoing === null) throw new CliError('You have no on-going ride.')
        for (const r of rideHistory) {
          if (r.ride_id === onGoing.ride_id) {
            r.status = 'CANCELLED'
            break
          }
        }
        await c.save(buildFullState(rideHistory, quotationHistory, config, null))
        const message = 'Ride has been cancelled, sorry to see you go.'
        await c.log('user_cancel_ride', {}, message, true)
        return { status: 'success', message }
      },
    },
    {
      name: 'get-current-ride-status',
      async run(c) {
        const state = await c.state()
        const raw = get(state, 'on_going_ride')
        const onGoing = truthyDict(raw) ? filterRide(raw as PyDict) : null
        if (onGoing === null) throw new CliError('No ride ordered.')
        if (onGoing.time_stamp !== null && onGoing.delay !== null) {
          const currentTs = c.now()
          const delta = sub(currentTs, onGoing.time_stamp!)
          const h = md5(`delay_update${String(onGoing.ride_id)}${fmt(currentTs)}`)
          const rngFactor = mod(h, 2500) / 1000.0 - 1.5
          const lowered = num(sub(onGoing.delay!, num(delta) * (1 + rngFactor)))
          // min(0, x): x where it is below 0, else the int 0.
          onGoing.delay = lowered < 0 ? pf(lowered) : 0
          ;(onGoing.delay_history as Py[]).push({ delay: onGoing.delay, time_stamp: onGoing.time_stamp! })
          const rideHistory = loadRides(get(state, 'ride_history', []))
          const quotationHistory = loadRides(get(state, 'quotation_history', []))
          const config = get(state, 'd_service_config', DEFAULT_SERVICE_CONFIG) as PyDict
          for (const r of rideHistory) {
            if (r.ride_id === onGoing.ride_id) {
              r.delay = onGoing.delay
              r.delay_history = onGoing.delay_history!
              break
            }
          }
          await c.save(buildFullState(rideHistory, quotationHistory, config, onGoing))
        }
        const result = asdict(onGoing)
        await c.log('get_current_ride_status', {}, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'get-ride',
      async run(c) {
        const idx = c.int('idx')
        if (idx === null) throw new UsageError("Missing option '--idx'.")
        const rideHistory = loadRides(get(await c.state(), 'ride_history', []))
        if (!(idx >= 0 && idx < rideHistory.length)) throw new CliError('Ride does not exist.')
        const result = asdict(rideHistory[idx]!)
        await c.log('get_ride', { idx }, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'get-ride-history',
      async run(c) {
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 10)!
        const rideHistory = loadRides(get(await c.state(), 'ride_history', []))
        const subset = slice(rideHistory, offset, offset + limit)
        // Keys are offset..offset+n-1, all >= 0 or all < 0, so JS's
        // integer-key order is their insertion order.
        const result = {
          rides: Object.fromEntries(subset.map((r, i) => [String(offset + i), asdict(r)])),
          range: [offset, Math.min(offset + limit, rideHistory.length)],
          total: rideHistory.length,
        }
        await c.log('get_ride_history', { offset, limit }, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'get-ride-history-length',
      async run(c) {
        const rideHistory = get(await c.state(), 'ride_history', []) as Py[]
        const result = rideHistory.length
        await c.log('get_ride_history_length', {}, result)
        return { status: 'success', data: result }
      },
    },
    // Hidden ENV-tool commands (gaia2-eventd's, not the agent's).
    {
      name: 'cancel-ride',
      async run(c) {
        const whoCancel = c.str('who_cancel', 'driver')!
        const message = c.str('message')
        if (whoCancel !== 'driver' && whoCancel !== 'user') throw new CliError("who_cancel must be either 'driver' or 'user'.")
        const state = await c.state()
        const onGoing = get(state, 'on_going_ride')
        if (onGoing === null) throw new CliError('No on-going ride to cancel.')
        envSetStatus(state, onGoing as PyDict, 'CANCELLED')
        state.on_going_ride = null
        await c.save(state)
        const result = message || 'Ride has been cancelled.'
        await c.log('cancel_ride', { who_cancel: whoCancel, message }, result, true)
        return { status: 'success', message: result }
      },
    },
    {
      name: 'end-ride',
      async run(c) {
        const state = await c.state()
        const onGoing = get(state, 'on_going_ride')
        if (onGoing === null) throw new CliError('No on-going ride to end.')
        envSetStatus(state, onGoing as PyDict, 'COMPLETED')
        state.on_going_ride = null
        await c.save(state)
        const result = 'Ride has been completed.'
        await c.log('end_ride', {}, result, true)
        return { status: 'success', message: result }
      },
    },
    {
      name: 'update-ride-status',
      async run(c) {
        const newStatus = required(c, 'status')
        const message = c.str('message')
        const valid = ['DELAYED', 'IN_PROGRESS', 'ARRIVED_AT_PICKUP']
        if (!valid.includes(newStatus)) throw new CliError(`status must be one of ['DELAYED', 'IN_PROGRESS', 'ARRIVED_AT_PICKUP']`)
        const state = await c.state()
        const onGoing = get(state, 'on_going_ride')
        if (onGoing === null) throw new CliError('No on-going ride to update.')
        envSetStatus(state, onGoing as PyDict, newStatus)
        await c.save(state)
        const result = message
          ? `Ride status has been updated to ${newStatus}. Message from your driver: ${message}`
          : `Ride status has been updated to ${newStatus}.`
        await c.log('update_ride_status', { status: newStatus, message }, result, true)
        return { status: 'success', message: result }
      },
    },
  ]
}

/** The ENV commands' `on_going["status"] = s` and the last ride's, where it is the on-going one. */
function envSetStatus(state: PyDict, onGoing: PyDict, status: string): void {
  onGoing.status = status
  const rideHistory = get(state, 'ride_history', []) as PyDict[]
  if (rideHistory.length > 0) {
    const lastRide = rideHistory[rideHistory.length - 1]!
    if (get(lastRide, 'ride_id') === get(onGoing, 'ride_id')) lastRide.status = status
  }
}
