/**
 * TimeServer (`servers/time/app.py`): day and second differences, weekdays,
 * unit conversion and adding seconds, over Python's `datetime`. Dates are
 * read as `strptime(s, "%Y-%m-%d")` reads them (its regex, Unicode digits
 * and all) and times as CPython's C `fromisoformat` parses them (its
 * byte-level grammar: basic and extended forms, ISO weeks, any separator
 * byte, fractions past six digits, hour 24). A time is microseconds since
 * 0001-01-01 and, when it has one, a UTC offset; errors are CPython 3.14's.
 * The tools have no return annotation, so their dicts carry no output
 * schema.
 */
import { PyError } from '../common.ts'
import { PyFloat, encode, lower, reprStr, strip, trueDiv } from '../../../../../workspace/py.ts'
import { plainTools } from '../tool.ts'

const US_PER_DAY = 86_400_000_000n

const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const daysInMonth = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m]!)
const DAYS_BEFORE_MONTH = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** `ymd_to_ord`: 0001-01-01 is day 1. */
function ymdToOrd(y: number, m: number, d: number): number {
  const py = y - 1
  return py * 365 + Math.floor(py / 4) - Math.floor(py / 100) + Math.floor(py / 400) + DAYS_BEFORE_MONTH[m]! + (m > 2 && isLeap(y) ? 1 : 0) + d
}

/** `ord_to_ymd`. */
function ordToYmd(ord: number): [number, number, number] {
  let n = ord - 1
  const n400 = Math.floor(n / 146097)
  n -= n400 * 146097
  const n100 = Math.floor(n / 36524)
  n -= n100 * 36524
  const n4 = Math.floor(n / 1461)
  n -= n4 * 1461
  const n1 = Math.floor(n / 365)
  n -= n1 * 365
  let year = n400 * 400 + n100 * 100 + n4 * 4 + n1 + 1
  if (n1 === 4 || n100 === 4) return [year - 1, 12, 31]
  let month = 1
  while (month < 12 && DAYS_BEFORE_MONTH[month + 1]! + (month + 1 > 2 && isLeap(year) ? 1 : 0) <= n) month++
  return [year, month, n - DAYS_BEFORE_MONTH[month]! - (month > 2 && isLeap(year) ? 1 : 0) + 1]
}

/** `check_date_args`. */
function checkDate(y: number, m: number, d: number): void {
  if (y < 1 || y > 9999) throw new PyError(`year must be in 1..9999, not ${y}`)
  if (m < 1 || m > 12) throw new PyError(`month must be in 1..12, not ${m}`)
  const dim = daysInMonth(y, m)
  if (d < 1 || d > dim) throw new PyError(`day ${d} must be in range 1..${dim} for month ${m} in year ${y}`)
}

/** `check_time_args`, as a message or null. */
function timeProblem(h: number, mi: number, s: number, us: number): string | null {
  if (h < 0 || h > 23) return `hour must be in 0..23, not ${h}`
  if (mi < 0 || mi > 59) return `minute must be in 0..59, not ${mi}`
  if (s < 0 || s > 59) return `second must be in 0..59, not ${s}`
  if (us < 0 || us > 999999) return `microsecond must be in 0..999999, not ${us}`
  return null
}

/** A datetime: microseconds since 0001-01-01 00:00, and its UTC offset in microseconds if aware. */
interface DateTime {
  us: bigint
  offset: bigint | null
}

const pad = (n: number | bigint, w = 2) => String(n).padStart(w, '0')

/** `datetime.strptime(s, "%Y-%m-%d")`. */
function strptimeDate(s: string): DateTime {
  const m = /^(\p{Nd}{4})-(1[0-2]|0[1-9]|[1-9])-(3[01]|[12]\p{Nd}|0[1-9]|[1-9]| [1-9])/iu.exec(s)
  if (!m) throw new PyError(`time data ${reprStr(s)} does not match format '%Y-%m-%d'`)
  if (m[0].length !== s.length) throw new PyError(`unconverted data remains: ${s.slice(m[0].length)}`)
  const num = (t: string) => Number(Array.from(t.trim(), (c) => String(digit(c))).join(''))
  const [y, mo, d] = [num(m[1]!), num(m[2]!), num(m[3]!)]
  checkDate(y, mo, d)
  return { us: BigInt(ymdToOrd(y, mo, d) - 1) * US_PER_DAY, offset: null }
}

/** A decimal digit's value (any script's). */
function digit(c: string): number {
  let cp = c.codePointAt(0)!
  let start = cp
  while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--
  return (cp - start) % 10
}

// --- fromisoformat, over the string's UTF-8 bytes as CPython's C parser reads them ---

/** The string's bytes and a NUL past them, which the C parser reads up to. */
type Bytes = Uint8Array

/** `parse_digits`: n ASCII digits at p, or null. */
function digits(b: Bytes, p: number, n: number): [number, number] | null {
  let v = 0
  for (let i = 0; i < n; i++) {
    const c = b[p + i] ?? 0
    if (c < 0x30 || c > 0x39) return null
    v = v * 10 + c - 0x30
  }
  return [v, p + n]
}

const isDigit = (c: number | undefined) => c !== undefined && c >= 0x30 && c <= 0x39

/** `_find_isoformat_datetime_separator`. */
function separatorAt(b: Bytes, len: number): number {
  if (len === 7) return 7
  if (b[4] === 0x2d) {
    if (b[5] === 0x57) {
      if (len < 8) return -1
      if (len > 8 && b[8] === 0x2d) {
        if (len === 9) return -1
        if (len > 10 && isDigit(b[10])) return 8
        return 10
      }
      return 8
    }
    return 10
  }
  if (b[4] === 0x57) {
    let idx = 7
    for (; idx < len; idx++) if (!isDigit(b[idx])) break
    if (idx < 9) return idx
    return idx % 2 === 0 ? 7 : 8
  }
  return 8
}

/** `iso_week1_monday`. */
function week1Monday(year: number): number {
  const first = ymdToOrd(year, 1, 1)
  const firstWeekday = (first + 6) % 7
  let monday = first - firstWeekday
  if (firstWeekday > 3) monday += 7
  return monday
}

/** `parse_isoformat_date`: [year, month, day], or null where it fails. */
function parseDate(b: Bytes, len: number): [number, number, number] | null {
  let r = digits(b, 0, 4)
  if (!r) return null
  const year = r[0]
  let p = r[1]
  const sep = b[p] === 0x2d
  if (sep) p++
  if (b[p] === 0x57) {
    p++
    r = digits(b, p, 2)
    if (!r) return null
    const week = r[0]
    p = r[1]
    let day = 1
    if (p < len) {
      if (sep && b[p++] !== 0x2d) return null
      r = digits(b, p, 1)
      if (!r) return null
      day = r[0]
    }
    if (year < 1 || year > 9999) return null
    if (week <= 0 || week >= 53) {
      let out = true
      if (week === 53) {
        const firstWeekday = (ymdToOrd(year, 1, 1) + 6) % 7
        if (firstWeekday === 3 || (firstWeekday === 2 && isLeap(year))) out = false
      }
      if (out) return null
    }
    if (day <= 0 || day >= 8) return null
    return ordToYmd(week1Monday(year) + (week - 1) * 7 + day - 1)
  }
  r = digits(b, p, 2)
  if (!r) return null
  const month = r[0]
  p = r[1]
  if (sep && b[p++] !== 0x2d) return null
  r = digits(b, p, 2)
  if (!r) return null
  return [year, month, r[0]]
}

/** `parse_hh_mm_ss_ff` from p to end: [code, h, m, s, us]; code < 0 fails, 1 is "not at the string's end". */
function parseHms(b: Bytes, p: number, end: number): [number, number, number, number, number] {
  const vals = [0, 0, 0]
  let hasSep = true
  let i = 0
  for (; i < 3; i++) {
    const r = digits(b, p, 2)
    if (!r) return [-3, 0, 0, 0, 0]
    vals[i] = r[0]
    p = r[1]
    const c = b[p++] ?? 0
    if (i === 0) hasSep = c === 0x3a
    if (p >= end) return [c !== 0 ? 1 : 0, vals[0]!, vals[1]!, vals[2]!, 0]
    if (hasSep && c === 0x3a) {
      if (i === 2) return [-4, 0, 0, 0, 0]
      continue
    }
    if (c === 0x2e || c === 0x2c) {
      if (i < 2) return [-3, 0, 0, 0, 0]
      break
    }
    if (!hasSep) p--
    else return [-4, 0, 0, 0, 0]
  }
  const remains = end - p
  const toParse = remains >= 6 ? 6 : remains
  const r = digits(b, p, toParse)
  if (!r) return [-3, 0, 0, 0, 0]
  let us = r[0]
  p = r[1]
  if (toParse > 0 && toParse < 6) us *= [100000, 10000, 1000, 100, 10][toParse - 1]!
  while (isDigit(b[p])) p++
  return [(b[p] ?? 0) !== 0 ? 1 : 0, vals[0]!, vals[1]!, vals[2]!, us]
}

/**
 * `parse_isoformat_time` from p: [code, h, m, s, us, tz seconds, tz us];
 * code 1 is aware. The offset's fields are not range-checked: the
 * timezone made of them is.
 */
function parseTime(b: Bytes, p: number, len: number): [number, number, number, number, number, number, number] {
  const end = len
  let tz = p
  do {
    const c = b[tz] ?? 0
    if (c === 0x5a || c === 0x2b || c === 0x2d) break
  } while (++tz < end)
  const [rv, h, mi, s, us] = parseHms(b, p, tz)
  if (rv < 0) return [rv, 0, 0, 0, 0, 0, 0]
  if (tz === end || tz > end) return [rv === 1 ? -5 : 0, h, mi, s, us, 0, 0]
  if (b[tz] === 0x5a) return [(b[tz + 1] ?? 0) !== 0 ? -5 : 1, h, mi, s, us, 0, 0]
  const sign = b[tz] === 0x2d ? -1 : 1
  const [trv, th, tm, ts, tus] = parseHms(b, tz + 1, end)
  return [trv ? -5 : 1, h, mi, s, us, sign * (th * 3600 + tm * 60 + ts), sign * tus]
}

/** `repr(timedelta)`: its normalized days, seconds and microseconds, those that are not 0. */
function reprDelta(us: bigint): string {
  const days = us >= 0n ? us / US_PER_DAY : -((-us + US_PER_DAY - 1n) / US_PER_DAY)
  const rest = us - days * US_PER_DAY
  const parts = [
    ['days', days],
    ['seconds', rest / 1_000_000n],
    ['microseconds', rest % 1_000_000n],
  ].filter(([, v]) => v !== 0n)
  return `datetime.timedelta(${parts.length ? parts.map(([k, v]) => `${k}=${v}`).join(', ') : '0'})`
}

/** `tzinfo_from_isoformat_results`: UTC for a zero offset (its microseconds dropped), else a timezone, which must be under a day. */
function tzOffset(seconds: number, us: number): bigint {
  if (seconds === 0) return 0n
  const offset = BigInt(seconds) * 1_000_000n + BigInt(us)
  if (offset <= -US_PER_DAY || offset >= US_PER_DAY) {
    throw new PyError(
      `offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24), not ${reprDelta(offset)}`,
    )
  }
  return offset
}

/** `datetime.fromisoformat(s)`. */
function fromIsoformat(s: string): DateTime {
  const invalid = () => new PyError(`Invalid isoformat string: ${reprStr(s)}`)
  if (Array.from(s).length < 7) throw invalid()
  const raw = encode(s)
  const len = raw.length
  const b = new Uint8Array(len + 16)
  b.set(raw)
  const sepAt = separatorAt(b, len)
  const date = parseDate(b, sepAt < 0 ? Number.MAX_SAFE_INTEGER : sepAt)
  if (!date) throw invalid()
  let [year, month, day] = date
  let [hour, minute, second, us, offset]: [number, number, number, number, bigint | null] = [0, 0, 0, 0, null]
  if (len > sepAt) {
    // The separator is any one character, however many bytes it takes.
    const lead = b[sepAt]!
    const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
    const [rv, h, mi, sec, micro, tzSeconds, tzUs] = parseTime(b, sepAt + width, len)
    if (rv < 0) throw invalid()
    ;[hour, minute, second, us] = [h, mi, sec, micro]
    if (rv === 1) offset = tzOffset(tzSeconds, tzUs)
  }
  if (hour === 24 && month <= 12 && month >= 1) {
    const dim = daysInMonth(year, month)
    if (day <= dim) {
      if (minute === 0 && second === 0 && us === 0) {
        hour = 0
        day += 1
        if (day > dim) {
          day = 1
          month += 1
          if (month > 12) {
            month = 1
            year += 1
          }
        }
      } else throw new PyError('minute, second, and microsecond must be 0 when hour is 24')
    }
  }
  checkDate(year, month, day)
  const problem = timeProblem(hour, minute, second, us)
  if (problem !== null) throw new PyError(problem)
  const t = BigInt(ymdToOrd(year, month, day) - 1) * US_PER_DAY + BigInt(((hour * 60 + minute) * 60 + second) * 1_000_000 + us)
  return { us: t, offset }
}

/** `dt2 - dt1` in microseconds. */
function subtract(a: DateTime, b: DateTime): bigint {
  if ((a.offset === null) !== (b.offset === null)) throw new PyError("can't subtract offset-naive and offset-aware datetimes")
  return a.us - (a.offset ?? 0n) - (b.us - (b.offset ?? 0n))
}

/** `dt.isoformat()`. */
function isoformat(t: DateTime): string {
  const day = Number(t.us / US_PER_DAY)
  let rest = t.us % US_PER_DAY
  const [y, m, d] = ordToYmd(day + 1)
  const us = Number(rest % 1_000_000n)
  rest /= 1_000_000n
  const [h, mi, s] = [rest / 3600n, (rest / 60n) % 60n, rest % 60n]
  let out = `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`
  if (us) out += `.${pad(us, 6)}`
  if (t.offset !== null) {
    const negative = t.offset < 0n
    let off = negative ? -t.offset : t.offset
    const offUs = off % 1_000_000n
    off /= 1_000_000n
    out += `${negative ? '-' : '+'}${pad(off / 3600n)}:${pad((off / 60n) % 60n)}`
    if (off % 60n || offUs) out += `:${pad(off % 60n)}`
    if (offUs) out += `.${pad(offUs, 6)}`
  }
  return out
}

const MAX_US = BigInt(ymdToOrd(9999, 12, 31)) * US_PER_DAY

/** `dt + timedelta(seconds=seconds)`. */
function addSeconds(t: DateTime, seconds: bigint): DateTime {
  const days = seconds >= 0n ? seconds / 86400n : -((-seconds + 86399n) / 86400n)
  if (days > 999999999n || days < -999999999n) throw new PyError(`days=${days}; must have magnitude <= 999999999`)
  const us = t.us + seconds * 1_000_000n
  if (us < 0n || us >= MAX_US) throw new PyError('date value out of range')
  return { us, offset: t.offset }
}

/** The tools' own `_parse_iso`: a trailing Z as +00:00, then `fromisoformat`. */
const parseIso = (s: string): DateTime => fromIsoformat(s.endsWith('Z') ? `${s.slice(0, -1)}+00:00` : s)

const UNIT_TO_SECONDS: Record<string, number> = { ms: 0.001, s: 1.0, min: 60.0, h: 3600.0, d: 86400.0, w: 604800.0 }

const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const tools = plainTools({
  days_diff: [
    [
      ['t1', 'str'],
      ['t2', 'str'],
    ],
    'none',
    ({ t1, t2 }) => {
      const a = strptimeDate(t1)
      const b = strptimeDate(t2)
      return { status: 'ok', output: `${(b.us - a.us) / US_PER_DAY} days` }
    },
  ],
  date_to_weekday: [
    [
      ['d', 'str'],
      ['locale', 'str', 'en'],
      ['short', 'bool', false],
    ],
    'none',
    ({ d, short }) => {
      const dt = strptimeDate(d)
      const idx = Number((dt.us / US_PER_DAY) % 7n)
      return { status: 'ok', output: (short ? WEEKDAYS_SHORT : WEEKDAYS_FULL)[idx] }
    },
  ],
  iso_seconds_diff: [
    [
      ['t1', 'str'],
      ['t2', 'str'],
    ],
    'none',
    ({ t1, t2 }) => {
      const dt1 = parseIso(t1)
      const dt2 = parseIso(t2)
      const delta = subtract(dt2, dt1)
      return { status: 'ok', output: Math.trunc(trueDiv(delta, 1_000_000n)) }
    },
  ],
  convert_time_units: [
    [
      ['value', 'float'],
      ['from_unit', 'str'],
      ['to_unit', 'str'],
    ],
    'none',
    ({ value, from_unit, to_unit }) => {
      const fu = lower(strip(from_unit))
      const tu = lower(strip(to_unit))
      if (!Object.hasOwn(UNIT_TO_SECONDS, fu)) return { status: 'error', output: `Unsupported from_unit: ${from_unit}` }
      if (!Object.hasOwn(UNIT_TO_SECONDS, tu)) return { status: 'error', output: `Unsupported to_unit: ${to_unit}` }
      const seconds = (value as PyFloat).v * UNIT_TO_SECONDS[fu]!
      return { status: 'ok', output: new PyFloat(seconds / UNIT_TO_SECONDS[tu]!) }
    },
  ],
  add_seconds_iso: [
    [
      ['t', 'str'],
      ['seconds', 'int'],
    ],
    'none',
    ({ t, seconds }) => {
      if (t.endsWith('Z')) t = `${t.slice(0, -1)}+00:00`
      const dt = fromIsoformat(t)
      return { status: 'ok', output: isoformat(addSeconds(dt, BigInt(seconds))) }
    },
  ],
})
