/**
 * Python's `datetime`, `date` and `timedelta`, as far as AutomationBench's
 * handlers use them, and Pydantic's reading and writing of them.
 *
 * The world keeps a datetime field as Pydantic's JSON writes it
 * (`2026-02-15T12:00:00Z`, `...00.500000Z`, `+05:30`, or naive with no
 * zone), and a date as `2026-02-15`. A handler that reads one gets a
 * `PyDateTime` (`dt()`), whose `isoformat()`, `str()` and `strftime()` are
 * Python's, and writes one back with `json()`.
 */
import { type PyObject, PyError, strRepr, valueError } from './py.ts'

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Days from 0001-01-01 (day 1) to y-m-d, Python's `toordinal()`. */
function ordinal(y: number, m: number, d: number): number {
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m - 1]! + (m > 2 && leap(y) ? 1 : 0)
  const py = y - 1
  return py * 365 + Math.floor(py / 4) - Math.floor(py / 100) + Math.floor(py / 400) + before + d
}
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
export const daysIn = (y: number, m: number) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!

/** Microseconds since 1970-01-01 of a wall time (as if UTC). */
function wallMicros(y: number, mo: number, d: number, h: number, mi: number, s: number, us: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, s) * 1000 + us
}

/** `datetime.timedelta`, in microseconds. */
export class PyTimedelta implements PyObject {
  readonly pyType = 'timedelta'
  readonly micros: number
  constructor(micros: number) {
    this.micros = micros
  }
  static of({ days = 0, hours = 0, minutes = 0, seconds = 0, microseconds = 0, weeks = 0 }: { days?: number; hours?: number; minutes?: number; seconds?: number; microseconds?: number; weeks?: number }): PyTimedelta {
    return new PyTimedelta(Math.round((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60e6 + seconds * 1e6 + microseconds))
  }
  get days(): number {
    return Math.floor(this.micros / 86400e6)
  }
  get seconds(): number {
    return Math.floor((this.micros - this.days * 86400e6) / 1e6)
  }
  totalSeconds(): number {
    return this.micros / 1e6
  }
  pyStr(): string {
    const days = this.days
    let rest = this.micros - days * 86400e6
    const us = rest % 1e6
    rest = (rest - us) / 1e6
    const h = Math.floor(rest / 3600)
    const m = Math.floor((rest % 3600) / 60)
    const s = rest % 60
    const time = `${h}:${pad(m)}:${pad(s)}${us ? `.${pad(us, 6)}` : ''}`
    return days ? `${days} day${Math.abs(days) === 1 ? '' : 's'}, ${time}` : time
  }
  pyRepr(): string {
    const parts: string[] = []
    if (this.days) parts.push(`days=${this.days}`)
    if (this.seconds) parts.push(`seconds=${this.seconds}`)
    const us = this.micros - this.days * 86400e6 - this.seconds * 1e6
    if (us) parts.push(`microseconds=${us}`)
    return `datetime.timedelta(${parts.join(', ')})`
  }
}

/** `datetime.date`. */
export class PyDate implements PyObject {
  readonly pyType: string = 'date'
  readonly year: number
  readonly month: number
  readonly day: number
  constructor(year: number, month: number, day: number) {
    this.year = year
    this.month = month
    this.day = day
    if (month < 1 || month > 12) throw valueError('month must be in 1..12')
    if (day < 1 || day > daysIn(year, month)) throw valueError('day is out of range for month')
  }
  static fromOrdinal(n: number): PyDate {
    const ms = (n - ordinal(1970, 1, 1)) * 86400e3
    const d = new Date(ms)
    return new PyDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  toordinal(): number {
    return ordinal(this.year, this.month, this.day)
  }
  /** Monday is 0. */
  weekday(): number {
    return (this.toordinal() + 6) % 7
  }
  isoformat(): string {
    return `${pad(this.year, 4)}-${pad(this.month)}-${pad(this.day)}`
  }
  pyStr(): string {
    return this.isoformat()
  }
  pyRepr(): string {
    return `datetime.date(${this.year}, ${this.month}, ${this.day})`
  }
  /** Pydantic's JSON. */
  json(): string {
    return this.isoformat()
  }
  addDays(n: number): PyDate {
    return PyDate.fromOrdinal(this.toordinal() + n)
  }
  compare(other: PyDate): number {
    if (other instanceof PyDateTime) throw new PyError('TypeError', "can't compare datetime.datetime to datetime.date")
    return Math.sign(this.toordinal() - other.toordinal())
  }
  strftime(format: string): string {
    return new PyDateTime(this.year, this.month, this.day, 0, 0, 0, 0, null).strftime(format)
  }
  /** `date.fromisoformat(text)`. */
  static fromisoformat(text: string): PyDate {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text)
    if (m === null || (text.includes('-') && text.length !== 10)) throw valueError(`Invalid isoformat string: ${strRepr(text)}`)
    return new PyDate(Number(m[1]), Number(m[2]), Number(m[3]))
  }
}

/** `datetime.datetime`: naive when `offset` is null, else at that many minutes east of UTC. */
export class PyDateTime extends PyDate {
  override readonly pyType = 'datetime'
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly microsecond: number
  readonly offset: number | null
  constructor(year: number, month: number, day: number, hour: number, minute: number, second: number, microsecond: number, offset: number | null) {
    super(year, month, day)
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) throw valueError('time out of range')
    this.hour = hour
    this.minute = minute
    this.second = second
    this.microsecond = microsecond
    this.offset = offset
  }

  /** The instant, in microseconds since the epoch; a naive time read as UTC. */
  get micros(): number {
    return wallMicros(this.year, this.month, this.day, this.hour, this.minute, this.second, this.microsecond) - (this.offset ?? 0) * 60e6
  }

  static fromMicros(micros: number, offset: number | null): PyDateTime {
    const wall = micros + (offset ?? 0) * 60e6
    const us = ((wall % 1e6) + 1e6) % 1e6
    const d = new Date((wall - us) / 1000)
    return new PyDateTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), us, offset)
  }

  /** `datetime.fromtimestamp(ts, tz)`: UTC when `utc`, else naive local, which is UTC here. */
  static fromtimestamp(seconds: number, utc: boolean): PyDateTime {
    return PyDateTime.fromMicros(Math.round(seconds * 1e6), utc ? 0 : null)
  }

  get aware(): boolean {
    return this.offset !== null
  }

  date(): PyDate {
    return new PyDate(this.year, this.month, this.day)
  }

  /** `timestamp()`: a naive time is local, which is UTC here. */
  timestamp(): number {
    return this.micros / 1e6
  }

  replace(fields: Partial<{ year: number; month: number; day: number; hour: number; minute: number; second: number; microsecond: number; offset: number | null }>): PyDateTime {
    return new PyDateTime(
      fields.year ?? this.year,
      fields.month ?? this.month,
      fields.day ?? this.day,
      fields.hour ?? this.hour,
      fields.minute ?? this.minute,
      fields.second ?? this.second,
      fields.microsecond ?? this.microsecond,
      'offset' in fields ? fields.offset! : this.offset,
    )
  }

  add(delta: PyTimedelta): PyDateTime {
    return PyDateTime.fromMicros(this.micros + delta.micros, this.offset)
  }

  sub(other: PyDateTime): PyTimedelta {
    if (this.aware !== other.aware) throw new PyError('TypeError', "can't subtract offset-naive and offset-aware datetimes")
    return new PyTimedelta(this.micros - other.micros)
  }

  /** `astimezone(timezone.utc)`. */
  utc(): PyDateTime {
    return PyDateTime.fromMicros(this.micros, 0)
  }

  override compare(other: PyDate): number {
    if (!(other instanceof PyDateTime)) throw new PyError('TypeError', "can't compare datetime.datetime to datetime.date")
    if (this.aware !== other.aware) throw new PyError('TypeError', "can't compare offset-naive and offset-aware datetimes")
    return Math.sign(this.micros - other.micros)
  }

  private zone(sep = ':'): string {
    if (this.offset === null) return ''
    const sign = this.offset < 0 ? '-' : '+'
    const off = Math.abs(this.offset)
    return `${sign}${pad(Math.floor(off / 60))}${sep}${pad(off % 60)}`
  }

  override isoformat(sep = 'T'): string {
    const frac = this.microsecond ? `.${pad(this.microsecond, 6)}` : ''
    return `${super.isoformat()}${sep}${pad(this.hour)}:${pad(this.minute)}:${pad(this.second)}${frac}${this.zone()}`
  }

  override pyStr(): string {
    return this.isoformat(' ')
  }

  override pyRepr(): string {
    const parts = [this.year, this.month, this.day, this.hour, this.minute]
    if (this.second || this.microsecond) parts.push(this.second)
    if (this.microsecond) parts.push(this.microsecond)
    const tz = this.offset === null ? '' : this.offset === 0 ? ', tzinfo=datetime.timezone.utc' : `, tzinfo=datetime.timezone(datetime.timedelta(seconds=${this.offset * 60}))`
    return `datetime.datetime(${parts.join(', ')}${tz})`
  }

  /** Pydantic's JSON: `Z` for UTC. */
  override json(): string {
    const frac = this.microsecond ? `.${pad(this.microsecond, 6)}` : ''
    const zone = this.offset === 0 ? 'Z' : this.zone()
    return `${super.isoformat()}T${pad(this.hour)}:${pad(this.minute)}:${pad(this.second)}${frac}${zone}`
  }

  override strftime(format: string): string {
    return format.replace(/%([a-zA-Z%])/g, (all, c: string) => {
      switch (c) {
        case 'Y':
          return String(this.year)
        case 'y':
          return pad(this.year % 100)
        case 'm':
          return pad(this.month)
        case 'd':
          return pad(this.day)
        case 'H':
          return pad(this.hour)
        case 'I':
          return pad(this.hour % 12 || 12)
        case 'M':
          return pad(this.minute)
        case 'S':
          return pad(this.second)
        case 'f':
          return pad(this.microsecond, 6)
        case 'p':
          return this.hour < 12 ? 'AM' : 'PM'
        case 'B':
          return MONTHS[this.month - 1]!
        case 'b':
          return MONTHS[this.month - 1]!.slice(0, 3)
        case 'A':
          return DAYS[this.weekday()]!
        case 'a':
          return DAYS[this.weekday()]!.slice(0, 3)
        case 'j':
          return pad(this.toordinal() - ordinal(this.year, 1, 1) + 1, 3)
        case 'z':
          return this.zone('')
        case 'Z':
          return this.offset === null ? '' : this.offset === 0 ? 'UTC' : `UTC${this.zone()}`
        case 'e':
          return String(this.day).padStart(2, ' ')
        case '%':
          return '%'
        default:
          return all
      }
    })
  }

  /**
   * `datetime.fromisoformat(text)` (Python 3.11+): a date, then `T` or any
   * one character, then `HH[:MM[:SS[.fff...]]]` and a zone (`Z`, `±HH:MM`).
   */
  static fromisoformat(text: string): PyDateTime {
    const bad = () => valueError(`Invalid isoformat string: ${strRepr(text)}`)
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:(.)(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?)?$/.exec(text)
    if (m === null) {
      const b = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
      if (b !== null) return new PyDateTime(Number(b[1]), Number(b[2]), Number(b[3]), 0, 0, 0, 0, null)
      throw bad()
    }
    const [, y, mo, d, , h, mi, s, frac, zone] = m
    let offset: number | null = null
    if (zone === 'Z') offset = 0
    else if (zone !== undefined) {
      const z = /^([+-])(\d{2}):?(\d{2})?/.exec(zone)!
      offset = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3] ?? 0))
    }
    const us = frac === undefined ? 0 : Number(frac.slice(0, 6).padEnd(6, '0'))
    try {
      return new PyDateTime(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), us, offset)
    } catch {
      throw bad()
    }
  }
}

/**
 * A datetime as Pydantic reads it into a `datetime` field (lax mode): an
 * ISO string (`T` or a space; seconds and a zone optional; a bare date is
 * midnight), or a Unix time in seconds (or milliseconds past 2e10), as a
 * number or a numeric string, which is UTC. Returns null where Pydantic
 * fails, with its message's tail.
 */
export function parseDatetime(value: unknown): PyDateTime | { error: string; type: string } {
  if (value instanceof PyDateTime) return value
  if (value instanceof PyDate) return new PyDateTime(value.year, value.month, value.day, 0, 0, 0, 0, null)
  const fromNumber = (n: number): PyDateTime => {
    const seconds = Math.abs(n) > 2e10 ? n / 1000 : n
    return PyDateTime.fromMicros(Math.round(seconds * 1e6), 0)
  }
  if (typeof value === 'number' || (typeof value === 'object' && value !== null && 'value' in value && typeof (value as { value: unknown }).value === 'number')) {
    return fromNumber(Number(value))
  }
  if (typeof value === 'boolean' || typeof value !== 'string') return { error: 'Input should be a valid datetime', type: 'datetime_type' }
  const text = value
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(text)) return fromNumber(Number(text))
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/.exec(text)
  if (m === null) {
    const tail =
      text.length < 10 || !/^\d{4}-\d{2}-\d{2}/.test(text)
        ? text.length < 10
          ? 'input is too short'
          : 'invalid character in year'
        : 'unexpected extra characters at the end of the input'
    return { error: `Input should be a valid datetime or date, ${tail}`, type: 'datetime_from_date_parsing' }
  }
  const [, y, mo, d, h, mi, s, frac, zone] = m
  let offset: number | null = null
  if (zone === 'Z' || zone === 'z') offset = 0
  else if (zone !== undefined) {
    const z = /^([+-])(\d{2}):?(\d{2})?/.exec(zone)!
    offset = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3] ?? 0))
  }
  try {
    return new PyDateTime(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), frac === undefined ? 0 : Number(frac.slice(0, 6).padEnd(6, '0')), offset)
  } catch {
    return { error: 'Input should be a valid datetime, day value is outside expected range', type: 'datetime_parsing' }
  }
}

/** A date as Pydantic reads it into a `date` field. */
export function parseDate(value: unknown): PyDate | { error: string; type: string } {
  if (value instanceof PyDateTime) {
    if (value.hour || value.minute || value.second || value.microsecond) return { error: 'Datetimes provided to dates should have zero time - e.g. be exact dates', type: 'date_from_datetime_inexact' }
    return value.date()
  }
  if (value instanceof PyDate) return value
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      return PyDate.fromisoformat(value)
    } catch {
      return { error: 'Input should be a valid date in the format YYYY-MM-DD, day value is outside expected range', type: 'date_from_datetime_parsing' }
    }
  }
  const dt = parseDatetime(value)
  if (!(dt instanceof PyDateTime)) return { error: dt.error.replace('valid datetime or date', 'valid date or datetime'), type: 'date_from_datetime_parsing' }
  if (dt.hour || dt.minute || dt.second || dt.microsecond) return { error: 'Datetimes provided to dates should have zero time - e.g. be exact dates', type: 'date_from_datetime_inexact' }
  return dt.date()
}

/** A world's stored datetime (Pydantic's JSON), as the `datetime` upstream's handler holds. */
export function dt(value: unknown): PyDateTime {
  const parsed = parseDatetime(value)
  if (!(parsed instanceof PyDateTime)) throw new Error(`not a stored datetime: ${String(value)}`)
  return parsed
}
