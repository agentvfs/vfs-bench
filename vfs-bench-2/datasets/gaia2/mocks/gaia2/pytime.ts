/**
 * Python's `datetime` in UTC, as gaia2-cli's apps use it: `strptime` with
 * `_strptime`'s exact patterns and ValueError messages, `fromtimestamp(ts,
 * tz=timezone.utc)` (microseconds rounded half-even, as CPython does),
 * `strftime` in the C locale, `timestamp()` and timedelta arithmetic.
 *
 * A `PyDateTime` holds whole seconds since the epoch and microseconds, so
 * its arithmetic is exact, as Python's integer-based datetime is.
 */
import { strRepr } from './pyrepr.ts'
import { pf, valueError, type PyFloat } from './store.ts'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Days from 1970-01-01 to a proleptic Gregorian date. */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(z: number): [number, number, number] {
  z += 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return [era * 400 + yoe + (m <= 2 ? 1 : 0), m, d]
}

const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
const monthDays = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!

/** An aware UTC datetime. */
export class PyDateTime {
  /** Whole seconds since the epoch. */
  readonly sec: number
  readonly us: number
  constructor(sec: number, us = 0) {
    this.sec = sec
    this.us = us
    const [year] = civilFromDays(Math.floor(sec / 86400))
    if (year < 1 || year > 9999) throw valueError(`year ${year} is out of range`)
  }

  /** `datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)`, checked as Python checks it. */
  static of(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, us = 0): PyDateTime {
    if (year < 1 || year > 9999) throw valueError(`year ${year} is out of range`)
    if (month < 1 || month > 12) throw valueError('month must be in 1..12')
    if (day < 1 || day > monthDays(year, month)) throw valueError('day is out of range for month')
    if (hour < 0 || hour > 23) throw valueError('hour must be in 0..23')
    if (minute < 0 || minute > 59) throw valueError('minute must be in 0..59')
    if (second < 0 || second > 59) throw valueError('second must be in 0..59')
    return new PyDateTime(daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second, us)
  }

  /** `datetime.fromtimestamp(ts, tz=timezone.utc)`. */
  static fromtimestamp(ts: number): PyDateTime {
    let sec = Math.floor(ts)
    let us = roundHalfEven((ts - sec) * 1e6)
    if (us >= 1_000_000) {
      sec += 1
      us -= 1_000_000
    }
    return new PyDateTime(sec, us)
  }

  get parts() {
    const days = Math.floor(this.sec / 86400)
    const rest = this.sec - days * 86400
    const [year, month, day] = civilFromDays(days)
    return {
      year,
      month,
      day,
      hour: Math.floor(rest / 3600),
      minute: Math.floor((rest % 3600) / 60),
      second: rest % 60,
      microsecond: this.us,
      /** `weekday()`: Monday is 0. */
      weekday: (((days + 3) % 7) + 7) % 7,
    }
  }

  /** `dt + timedelta(seconds=n)` for whole seconds. */
  plus(seconds: number): PyDateTime {
    return new PyDateTime(this.sec + seconds, this.us)
  }

  /** `dt.replace(hour=0, minute=0, second=0, microsecond=0)`. */
  midnight(): PyDateTime {
    return new PyDateTime(Math.floor(this.sec / 86400) * 86400, 0)
  }

  /** `dt.timestamp()`: a float. */
  timestamp(): number | PyFloat {
    return pf((this.sec * 1_000_000 + this.us) / 1_000_000)
  }

  /** `dt.strftime(fmt)` in the C locale (`%Y` zero-padded to four digits, as macOS's libc does). */
  strftime(fmt: string): string {
    const p = this.parts
    const two = (n: number) => String(n).padStart(2, '0')
    return fmt.replace(/%(.)/g, (whole, d: string) => {
      switch (d) {
        case 'A': return DAYS[p.weekday]!
        case 'a': return DAYS[p.weekday]!.slice(0, 3)
        case 'B': return MONTHS[p.month - 1]!
        case 'b': return MONTHS[p.month - 1]!.slice(0, 3)
        case 'Y': return String(p.year).padStart(4, '0')
        case 'm': return two(p.month)
        case 'd': return two(p.day)
        case 'H': return two(p.hour)
        case 'M': return two(p.minute)
        case 'S': return two(p.second)
        case 'f': return String(p.microsecond).padStart(6, '0')
        case '%': return '%'
        default: throw new Error(`strftime: unsupported directive ${whole}`)
      }
    })
  }
}

function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

// `_strptime`'s patterns, `\d` being any Unicode decimal digit and `\s` Python's whitespace.
const D = '\\p{Nd}'
const S = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const DIRECTIVES: Record<string, string> = {
  d: `(?<d>3[0-1]|[1-2]${D}|0[1-9]|[1-9]| [1-9])`,
  H: `(?<H>2[0-3]|[0-1]${D}|${D})`,
  m: '(?<m>1[0-2]|0[1-9]|[1-9])',
  M: `(?<M>[0-5]${D}|${D})`,
  S: `(?<S>6[0-1]|[0-5]${D}|${D})`,
  Y: `(?<Y>${D}${D}${D}${D})`,
  '%': '%',
}

/** `int(s)` for a run of Unicode decimal digits (and the space `%d` allows). */
function pyInt(text: string): number {
  let n = 0
  for (const ch of text.trim()) {
    const cp = ch.codePointAt(0)!
    // Nd digits come in whole runs of 0-9: a digit's value is its place in its run.
    let start = cp
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1
    n = n * 10 + ((cp - start) % 10)
  }
  return n
}

/**
 * `datetime.strptime(text, fmt)`, for the directives above, read as UTC:
 * the ValueError Python raises where it does not parse.
 */
export function strptime(text: string, fmt: string): PyDateTime {
  let pattern = fmt.replace(/[\\.^$*+?(){}[\]|]/g, '\\$&').replace(/\s+/g, `${S}+`).replace(/'/g, "['ʼ]")
  pattern = pattern.replace(/%(.)/g, (whole, d: string) => {
    const p = DIRECTIVES[d]
    if (p === undefined) throw new Error(`strptime: unsupported directive ${whole}`)
    return p
  })
  const found = new RegExp(`^(?:${pattern})`, 'iu').exec(text)
  if (found === null) throw valueError(`time data ${strRepr(text)} does not match format ${strRepr(fmt)}`)
  if (found[0].length !== text.length) throw valueError(`unconverted data remains: ${text.slice(found[0].length)}`)
  const g = found.groups ?? {}
  const field = (k: string, fallback: number) => (g[k] === undefined ? fallback : pyInt(g[k]!))
  const year = field('Y', 1900)
  const month = field('m', 1)
  const day = field('d', 1)
  // `_strptime` takes the date's ordinal first, then `datetime(...)` checks the rest.
  if (year < 1 || year > 9999) throw valueError(`year ${year} is out of range`)
  if (day > monthDays(year, month)) throw valueError('day is out of range for month')
  return PyDateTime.of(year, month, day, field('H', 0), field('M', 0), field('S', 0))
}
