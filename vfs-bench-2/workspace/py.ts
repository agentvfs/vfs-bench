/**
 * Python's values as ComplexMCP's apps print and store them.
 *
 * Upstream's apps are Python, so a float and an int are two types: a price
 * of 12 is `12.0` in a reply, a count of 12 is `12`. Here a Python int is a
 * JS number and a Python float a `PyFloat`, a number that remembers it is a
 * float. Arithmetic on them goes through `add`, `sub`, `mul` and `div`,
 * which give a float where Python's would. Comparisons work on either as
 * they are (`valueOf`); equality needs `num`.
 *
 * Each reply is a tool's result as fastmcp serializes it,
 * `pydantic_core.to_json` (`toJson`); f-strings print Python's `str` and
 * `repr` (`str`, `repr`). A run's stored state is JSON whose floats keep a
 * decimal point (`dumps`, `loads`).
 */
import { PyError } from '../datasets/complexmcp/mocks/complexmcp/common.ts'

export class PyFloat {
  readonly v: number
  constructor(v: number) {
    this.v = v
  }
  valueOf(): number {
    return this.v
  }
  toString(): string {
    return reprFloat(this.v)
  }
}

export type PyNum = number | PyFloat

export const F = (x: PyNum): PyFloat => (x instanceof PyFloat ? x : new PyFloat(x))
export const num = (x: PyNum): number => (x instanceof PyFloat ? x.v : x)
export const isFloat = (x: unknown): x is PyFloat => x instanceof PyFloat

const either = (a: PyNum, b: PyNum, v: number): PyNum => (isFloat(a) || isFloat(b) ? new PyFloat(v) : v)
export const add = (a: PyNum, b: PyNum): PyNum => either(a, b, num(a) + num(b))
export const sub = (a: PyNum, b: PyNum): PyNum => either(a, b, num(a) - num(b))
export const mul = (a: PyNum, b: PyNum): PyNum => either(a, b, num(a) * num(b))
/** `/`, which is always a float. */
export const div = (a: PyNum, b: PyNum): PyFloat => new PyFloat(num(a) / num(b))

/** `int(x)`: toward zero. */
export const int = (x: PyNum): number => Math.trunc(num(x))

/** `round(x)`: half to even, an int. */
export function roundInt(x: PyNum): number {
  const v = num(x)
  const floor = Math.floor(v)
  const diff = v - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * `round(x, ndigits)` on a float: the exact binary value rounded half to
 * even at that decimal place, as CPython's correctly rounded `round` does,
 * read back as the nearest float. On an int it is the int.
 */
export function round(x: PyNum, ndigits: number): PyNum {
  if (!isFloat(x)) return x
  const v = x.v
  if (!Number.isFinite(v) || v === 0) return x
  const [mantissa, exp] = exact(v)
  // v = mantissa * 2**exp = mantissa * 5**-exp / 10**-exp when exp < 0.
  if (exp >= 0) return x
  const places = BigInt(-exp)
  const scaled = mantissa * 5n ** places // v * 10**places, exactly
  const negative = scaled < 0n
  const abs = negative ? -scaled : scaled
  const drop = places - BigInt(ndigits)
  if (drop <= 0n) return x
  const unit = 10n ** drop
  let q = abs / unit
  const r = abs % unit
  if (r * 2n > unit || (r * 2n === unit && q % 2n === 1n)) q += 1n
  const digits = q.toString().padStart(ndigits + 1, '0')
  const text = ndigits > 0 ? `${digits.slice(0, -ndigits)}.${digits.slice(-ndigits)}` : digits
  return new PyFloat(Number(`${negative ? '-' : ''}${text}`))
}

/** A finite double as `mantissa * 2**exp`, both exact. */
function exact(v: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, v)
  const hi = buf.getUint32(0)
  const lo = buf.getUint32(4)
  const sign = hi >>> 31 ? -1n : 1n
  const e = (hi >>> 20) & 0x7ff
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  if (e === 0) return [sign * m, -1074]
  m |= 1n << 52n
  return [sign * m, e - 1075]
}

/** The shortest digits that read back as `v`, and the exponent of the first. */
function shortest(v: number): [string, number] {
  const [mant, exp] = Math.abs(v).toExponential().split('e')
  return [mant!.replace('.', ''), Number(exp)]
}

/** `f"{x:.{n}f}"`: the exact value rounded half to even, as Python formats it. */
export function fixed(x: PyNum, n: number): string {
  const v = num(x)
  if (!Number.isFinite(v)) return reprFloat(v)
  const text = num(round(new PyFloat(v), n)).toFixed(n)
  return (v < 0 || Object.is(v, -0)) && !text.startsWith('-') ? `-${text}` : text
}

/** Python's `repr(float)`. */
export function reprFloat(v: number): string {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  const sign = v < 0 || Object.is(v, -0) ? '-' : ''
  if (v === 0) return `${sign}0.0`
  const [digits, exp] = shortest(v)
  if (exp >= -4 && exp < 16) {
    if (exp >= digits.length - 1) return `${sign}${digits}${'0'.repeat(exp - digits.length + 1)}.0`
    if (exp >= 0) return `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
    return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`
  }
  const mant = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`
  const e = Math.abs(exp).toString().padStart(2, '0')
  return `${sign}${mant}e${exp < 0 ? '-' : '+'}${e}`
}

/** A float as pydantic_core's JSON writes it (Rust's ryu). */
export function jsonFloat(v: number): string {
  if (!Number.isFinite(v)) return 'null'
  const sign = v < 0 || Object.is(v, -0) ? '-' : ''
  if (v === 0) return `${sign}0.0`
  const [digits, exp] = shortest(v)
  const length = digits.length
  const kk = exp + 1
  const k = kk - length
  if (k >= 0 && kk <= 16) return `${sign}${digits}${'0'.repeat(k)}.0`
  if (kk > 0 && kk <= 16) return `${sign}${digits.slice(0, kk)}.${digits.slice(kk)}`
  if (kk > -5 && kk <= 0) return `${sign}0.${'0'.repeat(-kk)}${digits}`
  const mant = length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`
  return `${sign}${mant}e${kk - 1}`
}

/** A dataclass, for `repr`: its name and fields in order. */
export class Dataclass {
  readonly name: string
  readonly fields: Record<string, unknown>
  constructor(name: string, fields: Record<string, unknown>) {
    this.name = name
    this.fields = fields
  }
}

/** `pydantic_core.to_json(value)`: compact, floats as ryu prints them. */
export function toJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof PyFloat) return jsonFloat(value.v)
  if (value instanceof Dataclass) return toJson(value.fields)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : jsonFloat(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(toJson).join(',')}]`
  if (value instanceof Set) return toJson([...value])
  const entries = Object.entries(value as Record<string, unknown>)
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${toJson(v)}`).join(',')}}`
}

/** Python's `repr(str)`. */
export function reprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = quote
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += `\\${quote}`
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else if (code < 0x7f) out += ch
    else if (!printable(ch)) {
      out +=
        code <= 0xff
          ? `\\x${code.toString(16).padStart(2, '0')}`
          : code <= 0xffff
            ? `\\u${code.toString(16).padStart(4, '0')}`
            : `\\U${code.toString(16).padStart(8, '0')}`
    } else out += ch
  }
  return out + quote
}

/** `str.isprintable()` for one character past ASCII: not a control, format, separator or unassigned one. */
function printable(ch: string): boolean {
  return !/[\p{C}\p{Z}]/u.test(ch)
}

/** Python's `repr`. */
export function repr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (value instanceof PyFloat) return reprFloat(value.v)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : reprFloat(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'string') return reprStr(value)
  if (Array.isArray(value)) return `[${value.map(repr).join(', ')}]`
  if (value instanceof Dataclass) {
    return `${value.name}(${Object.entries(value.fields)
      .map(([k, v]) => `${k}=${repr(v)}`)
      .join(', ')})`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  return `{${entries.map(([k, v]) => `${reprStr(k)}: ${repr(v)}`).join(', ')}}`
}

/** Python's `str`, as an f-string prints a value. */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : repr(value)
}

/** A run's state as JSON, each float with its decimal point (Python's `json.dumps`). */
export function dumps(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof PyFloat) return reprJsonFloat(value.v)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : reprJsonFloat(value)
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(dumps).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${dumps(v)}`).join(',')}}`
}

function reprJsonFloat(v: number): string {
  return Number.isFinite(v) ? reprFloat(v) : v > 0 ? 'Infinity' : Number.isNaN(v) ? 'NaN' : '-Infinity'
}

/** Read `dumps`'s JSON back, a number with a point or an exponent a `PyFloat`. */
export function loads<T>(text: string): T {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source !== undefined && /[.eE]/.test(context.source) ? new PyFloat(value) : value,
  ) as T
}

/** A JSON request body's value as Python's `json.loads` reads it: a number with a point is a float. */
export const loadsJson = loads

/** `Levenshtein.distance(x, y)` over code points. */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[y.length]!
}

/** upstream's `lev_sim`: `1 - distance / max(len(x), len(y))`. */
export function levSim(x: string, y: string): number {
  return 1 - levenshtein(x, y) / Math.max(Array.from(x).length, Array.from(y).length)
}

/** Python's `len(str)`: code points. */
export const len = (s: string): number => Array.from(s).length

// --- datetime: naive times, as upstream's apps keep them ---

const STAMP = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/
const DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

/** A naive datetime, as ms since 1970 in UTC's calendar. */
export type DateTime = number

function valid(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): DateTime | null {
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  const t = new Date(ms)
  if (y < 1 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null
  // Date.UTC maps years 0-99 to 1900-1999.
  return y < 100 ? null : ms
}

/** `datetime.strptime(s, "%Y-%m-%d %H:%M:%S")`, or null where it raises ValueError. */
export function parseStamp(s: string): DateTime | null {
  const m = STAMP.exec(s)
  return m ? valid(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : null
}

/** `datetime.strptime(s, "%Y-%m-%d")`, or null where it raises ValueError. */
export function parseDate(s: string): DateTime | null {
  const m = DATE.exec(s)
  return m ? valid(+m[1]!, +m[2]!, +m[3]!) : null
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** `str(datetime)` of a time with no microseconds: `%Y-%m-%d %H:%M:%S`. */
export function formatStamp(t: DateTime): string {
  const d = new Date(t)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** `strftime("%Y-%m-%d")`. */
export function formatDate(t: DateTime): string {
  return formatStamp(t).slice(0, 10)
}

/** The day of a time (`.date()`), as the time of its midnight. */
export function dayOf(t: DateTime): DateTime {
  return Math.floor(t / 86_400_000) * 86_400_000
}

/**
 * `datetime.fromisoformat(s)` for the forms a date or a naive time takes
 * (`YYYY-MM-DD`, then `T` or a space and `HH`, `HH:MM`, `HH:MM:SS`, with a
 * fraction), or null where it raises. A time with a zone is `aware`, which
 * a naive one cannot be compared with.
 */
export function fromIso(s: string): { t: DateTime; aware: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?(Z|[+-]\d{2}:?\d{2}(?::?\d{2})?)?)?$/.exec(s)
  if (!m) return null
  const t = valid(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  if (t === null) return null
  const frac = m[7] ? Number(m[7].padEnd(6, '0')) / 1000 : 0
  if (!m[8]) return { t: t + frac, aware: false }
  if (m[8] === 'Z') return { t: t + frac, aware: true }
  const zone = m[8].replace(/:/g, '')
  const sign = zone[0] === '-' ? -1 : 1
  const offset = (+zone.slice(1, 3) * 3600 + +zone.slice(3, 5) * 60 + +(zone.slice(5, 7) || 0)) * 1000
  return { t: t + frac - sign * offset, aware: true }
}

// --- More of Python, for the plain servers (plain/): their values, ints
// past 2**53, sets and dicts of mixed keys, float math as CPython does it,
// str methods, and the bytes codecs. ---

/** A Python int: a JS number while it is exact, else a bigint. */
export type PyInt = number | bigint

/** An int as a bigint (a float-valued int is exact). */
export const big = (x: PyInt | PyFloat | boolean): bigint => (typeof x === 'bigint' ? x : BigInt(typeof x === 'boolean' ? Number(x) : num(x)))

/** A bigint back as a number where that is exact, as a reply prints either alike. */
export const small = (x: bigint): PyInt => (x >= -(2n ** 53n) && x <= 2n ** 53n ? Number(x) : x)

/** A Python complex, which only a negative float to a fractional power makes here. */
export class PyComplex {
  readonly re: number
  readonly im: number
  constructor(re: number, im: number) {
    this.re = re
    this.im = im
  }
}

/** `type(v).__name__`. */
export function pyType(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'string') return 'str'
  if (typeof v === 'bigint') return 'int'
  if (v instanceof PyFloat) return 'float'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'
  if (v instanceof PyComplex) return 'complex'
  if (Buffer.isBuffer(v)) return 'bytes'
  if (Array.isArray(v)) return 'list'
  if (v instanceof PyDict) return 'dict'
  if (v instanceof PySet) return 'set'
  return 'dict'
}

const numeric = (v: unknown): v is number | bigint | boolean | PyFloat =>
  typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' || v instanceof PyFloat

/** A float's value of a Python number (bool and int included). */
const asDouble = (v: number | bigint | boolean | PyFloat): number => (typeof v === 'boolean' ? Number(v) : Number(v instanceof PyFloat ? v.v : v))

function numEq(a: number | bigint | boolean | PyFloat, b: number | bigint | boolean | PyFloat): boolean {
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const x = typeof a === 'bigint' ? a : asDouble(a)
    const y = typeof b === 'bigint' ? b : asDouble(b)
    if (typeof x === 'number' && !Number.isInteger(x)) return false
    if (typeof y === 'number' && !Number.isInteger(y)) return false
    return BigInt(x) === BigInt(y)
  }
  return asDouble(a) === asDouble(b)
}

/** Python's `==`. */
export function pyEq(a: unknown, b: unknown): boolean {
  if (numeric(a) && numeric(b)) return numEq(a, b)
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => pyEq(x, b[i]))
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && pyEq(a[k], b[k]))
  }
  return false
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyFloat) && !(v instanceof PyDict) && !Buffer.isBuffer(v)

/** Python's `<` (lists element by element), or the TypeError it raises. */
export function pyLt(a: unknown, b: unknown): boolean {
  if (numeric(a) && numeric(b)) {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      const x = asDouble(a)
      const y = asDouble(b)
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isInteger(x) && Number.isInteger(y)) return big(a) < big(b)
      return x < y
    }
    return asDouble(a) < asDouble(b)
  }
  if (typeof a === 'string' && typeof b === 'string') return codePointLess(a, b)
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (!pyEq(a[i], b[i])) return pyLt(a[i], b[i])
    }
    return a.length < b.length
  }
  throw new PyError(`'<' not supported between instances of '${pyType(a)}' and '${pyType(b)}'`)
}

function codePointLess(a: string, b: string): boolean {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (c !== 0) return c < 0
  }
  return x.length < y.length
}

/** Python's `a + b` on the values a graph's weights can be. */
export function pyAdd(a: unknown, b: unknown): unknown {
  if (numeric(a) && numeric(b)) {
    if (a instanceof PyFloat || b instanceof PyFloat) return new PyFloat(asDouble(a) + asDouble(b))
    return small(big(a) + big(b))
  }
  if (typeof a === 'string' && typeof b === 'string') return a + b
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
  throw new PyError(`unsupported operand type(s) for +: '${pyType(a)}' and '${pyType(b)}'`)
}

/** `for x in v`: a list's items, a str's characters, a dict's keys. */
export function pyIter(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return Array.from(v)
  if (v instanceof PyDict) return v.keys()
  if (Buffer.isBuffer(v)) return [...v]
  if (isPlain(v)) return Object.keys(v)
  throw new PyError(`'${pyType(v)}' object is not iterable`)
}

/** `len(v)`. */
export function pyLen(v: unknown): number {
  if (typeof v === 'string' || Array.isArray(v) || v instanceof PyDict || isPlain(v)) return pyIter(v).length
  throw new PyError(`object of type '${pyType(v)}' has no len()`)
}

/** `a, b, ... = v`: its n values, or the error unpacking raises. */
export function unpack(v: unknown, n: number): unknown[] {
  if (!(typeof v === 'string' || Array.isArray(v) || isPlain(v))) throw new PyError(`cannot unpack non-iterable ${pyType(v)} object`)
  const items = pyIter(v)
  if (items.length < n) throw new PyError(`not enough values to unpack (expected ${n}, got ${items.length})`)
  if (items.length > n) throw new PyError(`too many values to unpack (expected ${n}${typeof v === 'string' ? '' : `, got ${items.length}`})`)
  return items
}

// --- Hashing: a set's order is its table's, which follows its keys' hashes ---

const MODULUS = (1n << 61n) - 1n

/** A double as `mantissa * 2**exp`, both exact (the module's `exact`). */
export const exactDouble = (v: number): [bigint, number] => exact(v)

/**
 * `hash(v)` for what sets and dicts hold here. An int's and a float's are
 * CPython's (the value mod 2**61 - 1); None's is CPython's constant. A
 * str's is salted per process upstream (PYTHONHASHSEED), so any fixed one
 * orders a set of strs no worse: this takes FNV-1a's.
 */
export function pyHash(v: unknown): bigint {
  if (v === null || v === undefined) return 4238894112n
  if (typeof v === 'string') {
    let h = 0xcbf29ce484222325n
    for (const b of Buffer.from(v, 'utf8')) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n)
    return fix(BigInt.asIntN(64, h))
  }
  if (typeof v === 'boolean') return v ? 1n : 0n
  if (typeof v === 'bigint') return intHash(v)
  if (Buffer.isBuffer(v)) return pyHash(v.toString('latin1'))
  if (numeric(v)) {
    const d = asDouble(v)
    if (Number.isInteger(d) && !(v instanceof PyFloat && Math.abs(d) > 2 ** 1023 * 2)) return intHash(BigInt(d))
    if (Number.isNaN(d)) return 0n
    if (!Number.isFinite(d)) return d > 0 ? 314159n : -314159n
    const [m, e] = exact(d)
    const sign = m < 0n ? -1n : 1n
    const mod = ((m < 0n ? -m : m) % MODULUS) * (1n << BigInt(((e % 61) + 61) % 61)) % MODULUS
    return fix(sign * mod)
  }
  const kind = Array.isArray(v) ? 'list' : 'dict'
  throw new PyError(`unhashable type: '${kind}'`)
}

const fix = (h: bigint): bigint => (h === -1n ? -2n : h)

function intHash(n: bigint): bigint {
  const a = n < 0n ? -n : n
  return fix((n < 0n ? -1n : 1n) * (a % MODULUS))
}

/**
 * The key a value is equal by, as a dict or a set compares keys: 1, 1.0 and
 * True are one key, "1" another. An unhashable one raises what CPython's
 * dict or set does.
 */
export function pyKey(v: unknown, what: 'dict key' | 'set element' = 'dict key'): string {
  if (v === null || v === undefined) return 'N'
  if (typeof v === 'string') return `s${v}`
  if (Buffer.isBuffer(v)) return `b${v.toString('hex')}`
  if (numeric(v)) {
    if (typeof v === 'bigint') return `n${v}`
    const d = asDouble(v)
    return Number.isInteger(d) ? `n${BigInt(d)}` : `f${d}`
  }
  const kind = Array.isArray(v) ? 'list' : 'dict'
  throw new PyError(`cannot use '${kind}' as a ${what} (unhashable type: '${kind}')`)
}

/** A Python dict over any hashable keys, in insertion order; a key keeps its first spelling. */
export class PyDict<V = unknown> {
  private readonly map = new Map<string, [unknown, V]>()

  static from<V>(entries: Iterable<[unknown, V]>): PyDict<V> {
    const d = new PyDict<V>()
    for (const [k, v] of entries) d.set(k, v)
    return d
  }

  get size(): number {
    return this.map.size
  }
  has(key: unknown): boolean {
    return this.map.has(pyKey(key))
  }
  get(key: unknown): V | undefined {
    return this.map.get(pyKey(key))?.[1]
  }
  set(key: unknown, value: V): void {
    const k = pyKey(key)
    const old = this.map.get(k)
    this.map.set(k, [old ? old[0] : key, value])
  }
  keys(): unknown[] {
    return [...this.map.values()].map(([k]) => k)
  }
  entries(): [unknown, V][] {
    return [...this.map.values()]
  }
}

const LINEAR_PROBES = 9
const DUMMY = Symbol('dummy')

interface Slot {
  key: unknown
  hash: bigint
}

/**
 * A Python set, kept in a table laid out as CPython's (setobject.c):
 * linear probing then perturbation, resizing at 3/5 full. Iterating it
 * walks the table, so its order is CPython's for the same keys.
 */
export class PySet {
  private table: (Slot | null | typeof DUMMY)[] = Array(8).fill(null)
  private mask = 7
  private fill = 0
  used = 0

  constructor(items: Iterable<unknown> = []) {
    for (const item of items) this.add(item)
  }

  private static hashOf(key: unknown): bigint {
    pyKey(key, 'set element')
    return pyHash(key)
  }

  private find(key: unknown, hash: bigint): number {
    const mask = BigInt(this.mask)
    let perturb = BigInt.asUintN(64, hash)
    let i = perturb & mask
    for (;;) {
      const probes = i + BigInt(LINEAR_PROBES) <= mask ? LINEAR_PROBES : 0
      let j = Number(i)
      for (let p = 0; p <= probes; p++, j++) {
        const slot = this.table[j]!
        if (slot === null) return -1 - j
        if (slot !== DUMMY && slot.hash === hash && pyEq(slot.key, key)) return j
      }
      perturb >>= 5n
      i = (i * 5n + 1n + perturb) & mask
    }
  }

  has(key: unknown): boolean {
    return this.find(key, PySet.hashOf(key)) >= 0
  }

  add(key: unknown): void {
    const hash = PySet.hashOf(key)
    const at = this.find(key, hash)
    if (at >= 0) return
    this.table[-1 - at] = { key, hash }
    this.fill++
    this.used++
    if (this.fill * 5 >= this.mask * 3) this.resize(this.used > 50000 ? this.used * 2 : this.used * 4)
  }

  discard(key: unknown): void {
    const at = this.find(key, PySet.hashOf(key))
    if (at < 0) return
    this.table[at] = DUMMY
    this.used--
  }

  private insertClean(table: (Slot | null | typeof DUMMY)[], mask: number, slot: Slot): void {
    const m = BigInt(mask)
    let perturb = BigInt.asUintN(64, slot.hash)
    let i = perturb & m
    for (;;) {
      if (table[Number(i)] === null) {
        table[Number(i)] = slot
        return
      }
      if (i + BigInt(LINEAR_PROBES) <= m) {
        for (let j = 1; j <= LINEAR_PROBES; j++) {
          if (table[Number(i) + j] === null) {
            table[Number(i) + j] = slot
            return
          }
        }
      }
      perturb >>= 5n
      i = (i * 5n + 1n + perturb) & m
    }
  }

  private resize(minused: number): void {
    let size = 8
    while (size <= minused) size <<= 1
    const old = this.table
    this.table = Array(size).fill(null)
    this.mask = size - 1
    this.fill = this.used
    for (const slot of old) if (slot !== null && slot !== DUMMY) this.insertClean(this.table, this.mask, slot)
  }

  /** `set(self)`: a copy, laid out as `set_merge` lays one out. */
  copy(): PySet {
    const out = new PySet()
    if ((out.fill + this.used) * 5 >= out.mask * 3) out.resize((out.used + this.used) * 2)
    if (out.mask === this.mask && this.fill === this.used) {
      out.table = [...this.table]
    } else {
      for (const slot of this.table) if (slot !== null && slot !== DUMMY) out.insertClean(out.table, out.mask, slot)
    }
    out.fill = this.used
    out.used = this.used
    return out
  }

  /** `self - other`, either way CPython's `set_difference` builds it. */
  difference(other: PySet): PySet {
    if (this.used >> 2 > other.used) {
      const out = this.copy()
      for (const key of other) out.discard(key)
      return out
    }
    const out = new PySet()
    for (const key of this) if (!other.has(key)) out.add(key)
    return out
  }

  *[Symbol.iterator](): Iterator<unknown> {
    for (const slot of this.table) if (slot !== null && slot !== DUMMY) yield slot.key
  }
}

// --- float arithmetic as CPython's floatobject.c and mathmodule.c do it ---

/** `a / b` on floats, raising ZeroDivisionError as Python 3.14 words it. */
export function fdiv(a: PyNum | bigint, b: PyNum | bigint): PyFloat {
  const y = Number(typeof b === 'bigint' ? b : num(b))
  if (y === 0) throw new PyError('division by zero')
  return new PyFloat(Number(typeof a === 'bigint' ? a : num(a)) / y)
}

/** `a % b` on floats (b nonzero). */
export function fmod(a: number, b: number): PyFloat {
  let mod = a % b
  if (mod) {
    if (b < 0 !== mod < 0) mod += b
  } else mod = b < 0 ? -0 : 0
  return new PyFloat(mod)
}

/** `a // b` on floats (b nonzero). */
export function ffloordiv(a: number, b: number): PyFloat {
  let mod = a % b
  let div = (a - mod) / b
  if (mod) {
    if (b < 0 !== mod < 0) {
      mod += b
      div -= 1.0
    }
  }
  let floordiv: number
  if (div) {
    floordiv = Math.floor(div)
    if (div - floordiv > 0.5) floordiv += 1.0
  } else floordiv = Object.is(Math.sign(a / b), -1) || Object.is(a / b, -0) ? -0 : 0
  return new PyFloat(floordiv)
}

const isOddInt = (w: number) => Number.isInteger(w) && Math.abs(w % 2) === 1

/**
 * `a ** b` on floats: C's pow (`libm.pow`), Python's errors (a zero to a
 * negative power, an overflow), and a complex where a negative number meets
 * a fractional power.
 */
export function fpow(v: number, w: number): PyFloat | PyComplex {
  if (w === 0) return new PyFloat(1.0)
  if (Number.isNaN(v)) return new PyFloat(v)
  if (Number.isNaN(w)) return new PyFloat(v === 1.0 ? 1.0 : w)
  if (!Number.isFinite(w)) {
    const a = Math.abs(v)
    if (a === 1.0) return new PyFloat(1.0)
    return new PyFloat(w > 0 === a > 1.0 ? Math.abs(w) : 0.0)
  }
  if (!Number.isFinite(v)) {
    const odd = isOddInt(w)
    if (w > 0) return new PyFloat(odd ? v : Math.abs(v))
    return new PyFloat(odd ? (v < 0 ? -0 : 0) : 0.0)
  }
  if (v === 0) {
    if (w < 0) throw new PyError('zero to a negative power')
    return new PyFloat(isOddInt(w) ? v : 0.0)
  }
  let negate = false
  if (v < 0) {
    if (w !== Math.floor(w)) return complexPow(v, w)
    v = -v
    negate = isOddInt(w)
  }
  if (v === 1.0) return new PyFloat(negate ? -1.0 : 1.0)
  const ix = libm.pow(v, w)
  if (!Number.isFinite(ix)) throw new PyError("(34, 'Result too large')")
  return new PyFloat(negate ? -ix : ix)
}

/** `complex(v) ** w` for a real w, as `_Py_c_pow` computes it. */
function complexPow(v: number, w: number): PyComplex {
  const vabs = Math.abs(v)
  const len = libm.pow(vabs, w)
  const phase = Math.atan2(0, v) * w
  return new PyComplex(len * libm.cos(phase), len * libm.sin(phase))
}

/** A complex as pydantic serializes one: `{re}+{im}j`, Rust's float printing, no real part when it is 0. */
export function complexText(c: PyComplex): string {
  const im = `${rustFloat(c.im)}j`
  if (c.re === 0) return im
  return `${rustFloat(c.re)}${c.im >= 0 || Number.isNaN(c.im) ? '+' : ''}${im}`
}

/** Rust's `{}` of an f64: its shortest digits, never an exponent. */
export function rustFloat(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  const sign = v < 0 || Object.is(v, -0) ? '-' : ''
  if (v === 0) return `${sign}0`
  const [digits, exp] = shortestDigits(v)
  if (exp >= digits.length - 1) return `${sign}${digits}${'0'.repeat(exp - digits.length + 1)}`
  if (exp >= 0) return `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
  return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`
}

const shortestDigits = (v: number): [string, number] => shortest(v)

/** `round(x, ndigits)` on a float, any ndigits: CPython's `double_round`. */
export function roundFloat(x: number, ndigits: number): PyFloat {
  if (!Number.isFinite(x) || x === 0) return new PyFloat(x)
  if (ndigits > 323) return new PyFloat(x)
  if (ndigits < -308) return new PyFloat(0.0 * x)
  const [mant, exp] = exact(x)
  const negative = mant < 0n
  const m = negative ? -mant : mant
  // x = m * 2**exp; scaled = x * 10**ndigits as a fraction num / den.
  let numer = m
  let denom = 1n
  if (exp >= 0) numer <<= BigInt(exp)
  else denom <<= BigInt(-exp)
  if (ndigits >= 0) numer *= 10n ** BigInt(ndigits)
  else denom *= 10n ** BigInt(-ndigits)
  let q = numer / denom
  const r = numer % denom
  if (r * 2n > denom || (r * 2n === denom && q % 2n === 1n)) q += 1n
  const text = `${negative ? '-' : ''}${q}e${-ndigits}`
  const out = Number(text)
  if (!Number.isFinite(out)) throw new PyError('rounded value too large to represent')
  return new PyFloat(out === 0 && negative ? -0 : out)
}

/**
 * `sum(xs)` of floats: 0 for none, else Neumaier's compensated sum, as
 * CPython 3.12+ adds floats.
 */
export function fsum(xs: readonly number[]): PyNum {
  if (xs.length === 0) return 0
  let f = 0 + xs[0]!
  let c = 0.0
  for (const x of xs.slice(1)) {
    const t = f + x
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x
    else c += x - t + f
    f = t
  }
  if (c && Number.isFinite(c)) f += c
  return new PyFloat(f)
}

/** x * y as a double and its exact error (an FMA's `fma(x, y, -x*y)`), by Dekker's product. */
function twoProduct(x: number, y: number): [number, number] {
  const p = x * y
  const split = (a: number): [number, number] => {
    const c = 134217729 * a
    const hi = c - (c - a)
    return [hi, a - hi]
  }
  const [xh, xl] = split(x)
  const [yh, yl] = split(y)
  const err = xh * yh - p + xh * yl + xl * yh + xl * yl
  return [p, err]
}

/** `math.hypot(a, b)`: CPython's `vector_norm`, not libm's hypot. */
export function hypot(a: number, b: number): number {
  const vec = [Math.abs(a), Math.abs(b)]
  let max = 0
  let foundNan = false
  for (const x of vec) {
    foundNan ||= Number.isNaN(x)
    if (x > max) max = x
  }
  return vectorNorm(vec, max, foundNan)
}

function vectorNorm(vec: number[], max: number, foundNan: boolean): number {
  if (!Number.isFinite(max) && !Number.isNaN(max)) return max
  if (foundNan) return NaN
  if (max === 0 || vec.length <= 1) return max
  const maxE = frexpExp(max)
  if (maxE < -1023) {
    const DBL_MIN = 2.2250738585072014e-308
    return DBL_MIN * vectorNorm(vec.map((x) => x / DBL_MIN), max / DBL_MIN, foundNan)
  }
  const scale = 2 ** -maxE
  let csum = 1.0
  let frac1 = 0.0
  let frac2 = 0.0
  for (let x of vec) {
    x *= scale
    const [hi, lo] = twoProduct(x, x)
    const s = csum + hi
    frac1 += lo
    frac2 += hi - (s - csum)
    csum = s
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2))
  const [hi, lo] = twoProduct(-h, h)
  const s = csum + hi
  frac1 += lo
  frac2 += hi - (s - csum)
  csum = s
  const x = csum - 1.0 + (frac1 + frac2)
  h += x / (2.0 * h)
  return h / scale
}

/** frexp's exponent: x = m * 2**e with 0.5 <= m < 1. */
function frexpExp(x: number): number {
  const [m, e] = exact(x)
  return e + (m < 0n ? -m : m).toString(2).length
}

// --- str: whitespace, case and the bytes codecs, as CPython has them ---

/** `str.isspace()`'s characters, which `\s` and `str.strip()` use. */
export const SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const SPACE_RE = new RegExp(`^[${SPACE}]$`, 'u')

export const isspace = (ch: string): boolean => SPACE_RE.test(ch)

/** `str.strip()`, or `str.strip(chars)`. */
export function strip(s: string, chars?: string): string {
  const cs = Array.from(s)
  const drop = chars === undefined ? isspace : (c: string) => chars.includes(c)
  let a = 0
  let b = cs.length
  while (a < b && drop(cs[a]!)) a++
  while (b > a && drop(cs[b - 1]!)) b--
  return cs.slice(a, b).join('')
}

/** `str.lower()` and `str.upper()`: JS's full case mappings are Python's. */
export const lower = (s: string): string => s.toLowerCase()
export const upper = (s: string): string => s.toUpperCase()

/**
 * Where a character's title case is not its upper case (`ToTitleFull`):
 * these map to themselves, the rest to what follows.
 */
const TITLE_SELF = [[0x1c5], [0x1c8], [0x1cb], [0x1f2], [0x10d0, 0x10fa], [0x10fd, 0x10ff], [0x1f88, 0x1f8f], [0x1f98, 0x1f9f], [0x1fa8, 0x1faf], [0x1fbc], [0x1fcc], [0x1ffc]]
const TITLE = new Map<number, string>(
  (
    'df:53,73 1c4:1c5 1c6:1c5 1c7:1c8 1c9:1c8 1ca:1cb 1cc:1cb 1f1:1f2 1f3:1f2 587:535,582 1f80:1f88 1f81:1f89 1f82:1f8a 1f83:1f8b ' +
    '1f84:1f8c 1f85:1f8d 1f86:1f8e 1f87:1f8f 1f90:1f98 1f91:1f99 1f92:1f9a 1f93:1f9b 1f94:1f9c 1f95:1f9d 1f96:1f9e 1f97:1f9f ' +
    '1fa0:1fa8 1fa1:1fa9 1fa2:1faa 1fa3:1fab 1fa4:1fac 1fa5:1fad 1fa6:1fae 1fa7:1faf 1fb2:1fba,345 1fb3:1fbc 1fb4:386,345 ' +
    '1fb7:391,342,345 1fc2:1fca,345 1fc3:1fcc 1fc4:389,345 1fc7:397,342,345 1ff2:1ffa,345 1ff3:1ffc 1ff4:38f,345 ' +
    '1ff7:3a9,342,345 fb00:46,66 fb01:46,69 fb02:46,6c fb03:46,66,69 fb04:46,66,6c fb05:53,74 fb06:53,74 fb13:544,576 ' +
    'fb14:544,565 fb15:544,56b fb16:54e,576 fb17:544,56d'
  )
    .split(' ')
    .map((e) => {
      const [c, t] = e.split(':')
      return [parseInt(c!, 16), String.fromCodePoint(...t!.split(',').map((x) => parseInt(x, 16)))]
    }),
)
for (const [a, b = a] of TITLE_SELF) for (let c = a!; c <= b; c++) TITLE.set(c, String.fromCodePoint(c))

/** `_PyUnicode_ToTitleFull` of one character. */
const toTitle = (ch: string): string => TITLE.get(ch.codePointAt(0)!) ?? ch.toUpperCase()

const CASED = /^\p{Cased}$/u
const CASE_IGNORABLE = /^\p{Case_Ignorable}$/u

/** A character lowered in its place, Σ's final form included (`lower_ucs4`). */
function lowerAt(cs: string[], i: number): string {
  if (cs[i] !== 'Σ') return cs[i]!.toLowerCase()
  let j = i - 1
  while (j >= 0 && CASE_IGNORABLE.test(cs[j]!)) j--
  const before = j >= 0 && CASED.test(cs[j]!)
  j = i + 1
  while (j < cs.length && CASE_IGNORABLE.test(cs[j]!)) j++
  const after = j < cs.length && CASED.test(cs[j]!)
  return before && !after ? 'ς' : 'σ'
}

/** `str.title()`. */
export function title(s: string): string {
  const cs = Array.from(s)
  let out = ''
  let previousCased = false
  for (let i = 0; i < cs.length; i++) {
    out += previousCased ? lowerAt(cs, i) : toTitle(cs[i]!)
    previousCased = CASED.test(cs[i]!)
  }
  return out
}

/** `str.capitalize()`: the first character in title case, the rest lowered. */
export function capitalize(s: string): string {
  const cs = Array.from(s)
  return cs.map((c, i) => (i === 0 ? toTitle(c) : lowerAt(cs, i))).join('')
}

/** `s.encode()`: UTF-8. */
export const encode = (s: string): Buffer => Buffer.from(s, 'utf8')

/** `b.decode()`: UTF-8, or the UnicodeDecodeError CPython's decoder words. */
export function decodeUtf8(b: Uint8Array): string {
  const bad = utf8Error(b)
  if (bad === null) return Buffer.from(b).toString('utf8')
  const [start, end, reason] = bad
  const where = end - start === 1 ? `byte 0x${b[start]!.toString(16).padStart(2, '0')} in position ${start}` : `bytes in position ${start}-${end - 1}`
  throw new PyError(`'utf-8' codec can't decode ${where}: ${reason}`)
}

const cont = (x: number | undefined) => x !== undefined && x >= 0x80 && x < 0xc0

/** CPython's first UTF-8 error: [start, end, reason], or null. */
function utf8Error(b: Uint8Array): [number, number, string] | null {
  let i = 0
  const n = b.length
  while (i < n) {
    const c = b[i]!
    if (c < 0x80) {
      i++
      continue
    }
    if (c < 0xc2 || c > 0xf4) return [i, i + 1, 'invalid start byte']
    const need = c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4
    const c2 = b[i + 1]
    if (i + 1 >= n) return [i, n, 'unexpected end of data']
    const lo = c === 0xe0 ? 0xa0 : c === 0xf0 ? 0x90 : 0x80
    const hi = c === 0xed ? 0x9f : c === 0xf4 ? 0x8f : 0xbf
    if (c2! < lo || c2! > hi) return [i, i + 1, 'invalid continuation byte']
    if (need >= 3) {
      if (i + 2 >= n) return [i, n, 'unexpected end of data']
      if (!cont(b[i + 2])) return [i, i + 2, 'invalid continuation byte']
    }
    if (need === 4) {
      if (i + 3 >= n) return [i, n, 'unexpected end of data']
      if (!cont(b[i + 3])) return [i, i + 3, 'invalid continuation byte']
    }
    i += need
  }
  return null
}

/** Bytes as pydantic serializes them, or Rust's Utf8Error when they are not UTF-8. */
export function bytesText(b: Uint8Array): string {
  const bad = utf8Error(b)
  if (bad === null) return Buffer.from(b).toString('utf8')
  const [start, end, reason] = bad
  if (reason === 'unexpected end of data') throw new PyError(`Error serializing to JSON: incomplete utf-8 byte sequence from index ${start}`)
  throw new PyError(`Error serializing to JSON: invalid utf-8 sequence of ${end - start} bytes from index ${start}`)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** `base64.b64decode(data)`: binascii's lenient `a2b_base64`, its errors and all. */
export function b64decode(data: Uint8Array): Buffer {
  const out: number[] = []
  let quad = 0
  let left = 0
  let pads = 0
  for (const ch of data) {
    if (ch === 0x3d) {
      if (quad >= 2 && quad + ++pads >= 4) return Buffer.from(out)
      continue
    }
    const v = B64.indexOf(String.fromCharCode(ch))
    if (ch > 0x7f || v < 0) continue
    pads = 0
    if (quad === 0) {
      quad = 1
      left = v
    } else if (quad === 1) {
      quad = 2
      out.push(((left << 2) | (v >> 4)) & 0xff)
      left = v & 0x0f
    } else if (quad === 2) {
      quad = 3
      out.push(((left << 4) | (v >> 2)) & 0xff)
      left = v & 0x03
    } else {
      quad = 0
      out.push(((left << 6) | v) & 0xff)
      left = 0
    }
  }
  if (quad === 1) {
    throw new PyError(`Invalid base64-encoded string: number of data characters (${Math.floor(out.length / 3) * 4 + 1}) cannot be 1 more than a multiple of 4`)
  }
  if (quad !== 0) throw new PyError('Incorrect padding')
  return Buffer.from(out)
}

/** `binascii.unhexlify(s)`. */
export function unhexlify(s: string): Buffer {
  if (Array.from(s).some((c) => c.codePointAt(0)! > 0x7f)) throw new PyError('string argument should contain only ASCII characters')
  if (s.length % 2 === 1) throw new PyError('Odd-length string')
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new PyError('Non-hexadecimal digit found')
  return Buffer.from(s, 'hex')
}

/**
 * `pydantic_core.to_json(value)` as fastmcp writes a reply: `toJson`, but a
 * float that is not finite is `Infinity`, `-Infinity` or `NaN`, a PyDict's
 * keys print as `str()` does, a bigint whole and a complex as pydantic does.
 */
export function pyToJson(value: unknown): string {
  if (value instanceof PyFloat || (typeof value === 'number' && !Number.isInteger(value))) {
    const v = Number(value)
    if (Number.isNaN(v)) return 'NaN'
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
    return jsonFloat(v)
  }
  if (value instanceof PyComplex) return JSON.stringify(complexText(value))
  if (Buffer.isBuffer(value)) return JSON.stringify(bytesText(value))
  if (Array.isArray(value)) return `[${value.map(pyToJson).join(',')}]`
  if (value instanceof PySet) return pyToJson([...value])
  if (value instanceof PyDict) {
    return `{${value
      .entries()
      .map(([k, v]) => `${JSON.stringify(keyText(k))}:${pyToJson(v)}`)
      .join(',')}}`
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Dataclass)) {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}:${pyToJson(v)}`)
      .join(',')}}`
  }
  return toJson(value)
}

/** A dict key as pydantic writes it in JSON. */
function keyText(k: unknown): string {
  if (typeof k === 'string') return k
  if (k === null || k === undefined) return 'None'
  if (typeof k === 'boolean') return k ? 'true' : 'false'
  return repr(k)
}

// --- libm, correctly rounded: CPython's math functions are the platform's
// libm (glibc's upstream, macOS's here), both within a hair of correctly
// rounded; V8's are fdlibm's, a last place off for one input in ten. So
// these compute each in 200-bit binary floating point (`Big`) and round
// once. ---

const P = 200

/** m * 2**e, m kept to P bits. */
interface Big {
  m: bigint
  e: number
}

const bitLength = (m: bigint): number => (m === 0n ? 0 : (m < 0n ? -m : m).toString(2).length)

function norm(m: bigint, e: number): Big {
  const n = bitLength(m)
  if (n <= P) return { m, e }
  const s = n - P
  return { m: m >> BigInt(s), e: e + s }
}

const bigOf = (x: number): Big => {
  const [m, e] = exact(x)
  return norm(m, e)
}
const bigInt = (n: bigint | number): Big => norm(BigInt(n), 0)

function badd(a: Big, b: Big): Big {
  if (a.m === 0n) return b
  if (b.m === 0n) return a
  // Shift the operand with the bigger exponent down to the other's, at most P + 64 bits apart.
  if (a.e < b.e) [a, b] = [b, a]
  const gap = a.e - b.e
  if (gap > P + 64 + bitLength(b.m) - bitLength(a.m) && bitLength(a.m) + a.e > bitLength(b.m) + b.e + P + 2) return a
  return norm((a.m << BigInt(gap)) + b.m, b.e)
}
const bneg = (a: Big): Big => ({ m: -a.m, e: a.e })
const bsub = (a: Big, b: Big): Big => badd(a, bneg(b))
const bmul = (a: Big, b: Big): Big => norm(a.m * b.m, a.e + b.e)
function bdiv(a: Big, b: Big): Big {
  const shift = P + 2 + bitLength(b.m) - bitLength(a.m)
  const s = Math.max(shift, 0)
  return norm((a.m << BigInt(s)) / b.m, a.e - b.e - s)
}
const bshift = (a: Big, k: number): Big => ({ m: a.m, e: a.e + k })
function bsqrt(a: Big): Big {
  // isqrt of m * 2**(2P + parity), then halve the exponent.
  let e = a.e - 2 * P - 4
  if ((e & 1) !== 0) e -= 1
  const m = a.m << BigInt(a.e - e)
  let x = 1n << BigInt(Math.ceil(bitLength(m) / 2) + 1)
  for (;;) {
    const y = (x + m / x) >> 1n
    if (y >= x) break
    x = y
  }
  return norm(x, e / 2)
}
const bcmpAbs = (a: Big, b: Big): number => {
  const d = bsub({ m: a.m < 0n ? -a.m : a.m, e: a.e }, { m: b.m < 0n ? -b.m : b.m, e: b.e })
  return d.m === 0n ? 0 : d.m < 0n ? -1 : 1
}

/** Round to the nearest double, ties to even (the bits past P are gone, which a tie that close never needs). */
function toDouble(a: Big): number {
  if (a.m === 0n) return 0
  const negative = a.m < 0n
  let m = negative ? -a.m : a.m
  let e = a.e
  const n = bitLength(m)
  // The value is in [2**(n+e-1), 2**(n+e)); a double keeps 53 bits, fewer when subnormal.
  const top = n + e - 1
  const keep = top >= -1022 ? 53 : 53 - (-1022 - top)
  if (keep <= 0) {
    // Below half the smallest subnormal, or at most it.
    const half = top === -1075 && m !== 1n << BigInt(n - 1)
    return negative ? -(half ? 5e-324 : 0) : half ? 5e-324 : 0
  }
  const drop = n - keep
  if (drop > 0) {
    const rest = m & ((1n << BigInt(drop)) - 1n)
    m >>= BigInt(drop)
    e += drop
    const half = 1n << BigInt(drop - 1)
    if (rest > half || (rest === half && (m & 1n) === 1n)) m += 1n
  }
  const out = Number(m) * 2 ** Math.max(e, -1074) * (e < -1074 ? 2 ** (e + 1074) : 1)
  return negative ? -out : out
}

/** A constant to P + 64 bits: ln 2 and pi, by their series. */
const LN2: Big = (() => {
  // ln 2 = sum 1 / (k 2**k).
  const bits = BigInt(P + 64)
  let s = 0n
  for (let k = 1n; k < bits + 8n; k++) s += (1n << bits) / (k << k)
  return norm(s, -(P + 64))
})()

/** pi to `bits` bits past the point, by Machin's formula. */
function piFixed(bits: number): bigint {
  const one = 1n << BigInt(bits + 16)
  const arctan = (inv: bigint): bigint => {
    let sum = 0n
    let term = one / inv
    const inv2 = inv * inv
    for (let k = 1n; term !== 0n; k += 2n) {
      sum += (k % 4n === 1n ? 1n : -1n) * (term / k)
      term /= inv2
    }
    return sum
  }
  return (16n * arctan(5n) - 4n * arctan(239n)) >> 16n
}
let piCache: [number, bigint] = [0, 0n]
function pi(bits: number): Big {
  if (piCache[0] < bits) piCache = [bits + 256, piFixed(bits + 256)]
  return norm(piCache[1], -piCache[0])
}

/** Sum of a power series sum c_k t**k until its terms vanish. */
function series(t: Big, coef: (k: number) => Big | null, start = 0): Big {
  let sum: Big = { m: 0n, e: 0 }
  let power = start === 0 ? bigInt(1) : t
  for (let k = start; ; k++) {
    const c = coef(k)
    if (c !== null) {
      const term = bmul(c, power)
      if (term.m === 0n || (sum.m !== 0n && bitLength(term.m) + term.e < bitLength(sum.m) + sum.e - P - 8)) break
      sum = badd(sum, term)
    }
    power = bmul(power, t)
    if (k > 4 * P) break
  }
  return sum
}

function bexp(x: Big): Big {
  // x = k ln 2 + r, then exp(r) = exp(r / 2**8)**(2**8).
  const k = BigInt(Math.round(toDouble(bdiv(x, LN2))))
  const r = bshift(bsub(x, bmul(bigInt(k), LN2)), -8)
  let fact = 1n
  let y = series(r, (j) => {
    if (j > 1) fact *= BigInt(j)
    return bdiv(bigInt(1), bigInt(fact))
  })
  for (let i = 0; i < 8; i++) y = bmul(y, y)
  return bshift(y, Number(k))
}

function blog(x: Big): Big {
  // x = m 2**e with m in [sqrt(1/2), sqrt(2)), log m = 2 atanh((m - 1) / (m + 1)).
  let e = bitLength(x.m) + x.e - 1
  let m = bshift(x, -e)
  if (toDouble(m) > Math.SQRT2) {
    m = bshift(m, -1)
    e += 1
  }
  const t = bdiv(bsub(m, bigInt(1)), badd(m, bigInt(1)))
  const t2 = bmul(t, t)
  const at = bmul(t, series(t2, (j) => bdiv(bigInt(1), bigInt(2 * j + 1))))
  return badd(bmul(bigInt(e), LN2), bshift(at, 1))
}

/** x reduced mod pi/2: r in [-pi/4, pi/4] and the quadrant, from a pi wide enough that r is exact to P bits. */
function reduce(x: Big): [Big, number] {
  const size = Math.max(bitLength(x.m) + x.e, 0)
  pi(size + P + 128)
  const [n, piN] = [piCache[0], piCache[1]]
  // pi/2 = piN / 2**(n + 1); x = m 2**e; q = round(x / (pi/2)).
  const shift = x.e + n + 1
  const xn = shift >= 0 ? x.m << BigInt(shift) : x.m >> BigInt(-shift)
  let q = xn / piN
  const rest = xn - q * piN
  if (2n * (rest < 0n ? -rest : rest) > piN) q += rest < 0n ? -1n : 1n
  const r = norm(xn - q * piN, -(n + 1))
  return [r, Number(((q % 4n) + 4n) % 4n)]
}

function sinCos(r: Big): [Big, Big] {
  const r2 = bmul(r, r)
  let f = 1n
  const s = bmul(
    r,
    series(r2, (j) => {
      if (j > 0) f *= BigInt(2 * j) * BigInt(2 * j + 1)
      return bdiv(bigInt(j % 2 === 0 ? 1 : -1), bigInt(f))
    }),
  )
  let g = 1n
  const c = series(r2, (j) => {
    if (j > 0) g *= BigInt(2 * j - 1) * BigInt(2 * j)
    return bdiv(bigInt(j % 2 === 0 ? 1 : -1), bigInt(g))
  })
  return [s, c]
}

function batan(x: Big): Big {
  const negative = x.m < 0n
  let t: Big = negative ? bneg(x) : x
  let base: Big | null = null
  if (bcmpAbs(t, bigInt(1)) > 0) {
    base = bshift(pi(P + 64), -1)
    t = bdiv(bigInt(1), t)
  }
  // atan t = 2 atan(t / (1 + sqrt(1 + t**2))), four times.
  for (let i = 0; i < 4; i++) t = bdiv(t, badd(bigInt(1), bsqrt(badd(bigInt(1), bmul(t, t)))))
  const t2 = bmul(t, t)
  let y = bshift(bmul(t, series(t2, (j) => bdiv(bigInt(j % 2 === 0 ? 1 : -1), bigInt(2 * j + 1)))), 4)
  if (base) y = bsub(base, y)
  return negative ? bneg(y) : y
}

/** sinh by its series where e**x - e**-x would cancel. */
function bsinh(x: Big): Big {
  if (bcmpAbs(x, bigInt(1)) < 0) {
    let f = 1n
    return bmul(
      x,
      series(bmul(x, x), (j) => {
        if (j > 0) f *= BigInt(2 * j) * BigInt(2 * j + 1)
        return bdiv(bigInt(1), bigInt(f))
      }),
    )
  }
  const e = bexp(x)
  return bshift(bsub(e, bdiv(bigInt(1), e)), -1)
}

const finiteNonzero = (x: number) => Number.isFinite(x) && x !== 0

/** The math functions, each its correctly rounded result (NaN and the infinities as C99 has them). */
export const libm = {
  exp(x: number): number {
    if (Number.isNaN(x)) return x
    if (x === Infinity) return x
    if (x === -Infinity) return 0
    if (x > 710) return Infinity
    if (x < -746) return 0
    if (x === 0) return 1
    return toDouble(bexp(bigOf(x)))
  },
  log(x: number): number {
    if (Number.isNaN(x) || x < 0) return NaN
    if (x === 0) return -Infinity
    if (x === Infinity) return x
    return toDouble(blog(bigOf(x)))
  },
  /** glibc's log10 (fdlibm's: k log10(2) in two parts, plus log(m) / ln 10), which is not correctly rounded. */
  log10(x: number): number {
    if (!(x > 0) || x === Infinity) return libm.log(x)
    let k = 0
    if (x < 2.2250738585072014e-308) {
      k -= 54
      x *= 18014398509481984
    }
    const [m, e] = exact(x)
    k += bitLength(m) + e - 1
    const i = k < 0 ? 1 : 0
    const y = k + i
    const scaled = Number(m) * 2 ** (1 - bitLength(m) - i)
    const z = y * 3.69423907715893078616e-13 + 4.34294481903251816668e-1 * libm.log(scaled)
    return z + y * 3.01029995663611771306e-1
  },
  log2(x: number): number {
    if (!(x > 0) || x === Infinity) return libm.log(x)
    return toDouble(bdiv(blog(bigOf(x)), LN2))
  },
  sin(x: number): number {
    if (!finiteNonzero(x)) return Number.isFinite(x) ? x : NaN
    const [r, q] = reduce(bigOf(x))
    const [s, c] = sinCos(r)
    return toDouble([s, c, bneg(s), bneg(c)][q]!)
  },
  cos(x: number): number {
    if (!Number.isFinite(x)) return NaN
    if (x === 0) return 1
    const [r, q] = reduce(bigOf(x))
    const [s, c] = sinCos(r)
    return toDouble([c, bneg(s), bneg(c), s][q]!)
  },
  tan(x: number): number {
    if (!finiteNonzero(x)) return Number.isFinite(x) ? x : NaN
    const [r, q] = reduce(bigOf(x))
    const [s, c] = sinCos(r)
    return toDouble(q % 2 === 0 ? bdiv(s, c) : bneg(bdiv(c, s)))
  },
  atan(x: number): number {
    if (Number.isNaN(x) || x === 0) return x
    if (!Number.isFinite(x)) return x > 0 ? Math.PI / 2 : -Math.PI / 2
    return toDouble(batan(bigOf(x)))
  },
  asin(x: number): number {
    if (Number.isNaN(x) || x === 0) return x
    if (x > 1 || x < -1) return NaN
    if (x === 1 || x === -1) return toDouble(bshift(pi(P + 64), -1)) * x
    const b = bigOf(x)
    return toDouble(batan(bdiv(b, bsqrt(bsub(bigInt(1), bmul(b, b))))))
  },
  acos(x: number): number {
    if (Number.isNaN(x)) return x
    if (x > 1 || x < -1) return NaN
    if (x === 1) return 0
    if (x === -1) return toDouble(pi(P + 64))
    const b = bigOf(x)
    const asin = batan(bdiv(b, bsqrt(bsub(bigInt(1), bmul(b, b)))))
    return toDouble(bsub(bshift(pi(P + 64), -1), asin))
  },
  /** x**y for a positive finite x and a finite y, correctly rounded (glibc's pow is within 0.52 ulp; V8's is fdlibm's). */
  pow(x: number, y: number): number {
    if (y === 2) return x * x
    if (y === 0.5) return Math.sqrt(x)
    if (x === 1 || y === 0) return 1
    const log = blog(bigOf(x))
    const t = bmul(bigOf(y), log)
    // Past the double range either way: no need to build the power.
    const approx = toDouble(t)
    if (approx > 710) return Infinity
    if (approx < -746) return 0
    return toDouble(bexp(t))
  },
  /** glibc's expm1 (fdlibm's s_expm1.c), which sinh and tanh build on. */
  expm1(x: number): number {
    const Q = [1.0, -3.33333333333331316428e-2, 1.58730158725481460165e-3, -7.93650757867487942473e-5, 4.00821782732936239552e-6, -2.01099218183624371326e-7]
    const ln2Hi = 6.9314718036912381649e-1
    const ln2Lo = 1.90821492927058770002e-10
    const negative = x < 0 || Object.is(x, -0)
    const a = Math.abs(x)
    if (Number.isNaN(x)) return x
    if (a >= 38.81622314453125) {
      if (a >= 709.7822265625) {
        if (!Number.isFinite(x)) return negative ? -1.0 : x
        if (x > 7.09782712893383973096e2) return Infinity
      }
      if (negative) return 1.0e-300 - 1.0
    }
    let k: number
    let c = 0
    if (a >= 0.3465735912322998) {
      let hi: number
      let lo: number
      if (a < 1.0397205352783203) {
        if (!negative) [hi, lo, k] = [x - ln2Hi, ln2Lo, 1]
        else [hi, lo, k] = [x + ln2Hi, -ln2Lo, -1]
      } else {
        k = Math.trunc(1.442695040888963387 * x + (negative ? -0.5 : 0.5))
        const t = k
        hi = x - t * ln2Hi
        lo = t * ln2Lo
      }
      x = hi - lo
      c = hi - x - lo
    } else if (a < 2 ** -54) {
      return x
    } else k = 0
    const hfx = 0.5 * x
    const hxs = x * hfx
    const R1 = 1.0 + hxs * Q[1]!
    const h2 = hxs * hxs
    const R2 = Q[2]! + hxs * Q[3]!
    const h4 = h2 * h2
    const R3 = Q[4]! + hxs * Q[5]!
    const r1 = R1 + h2 * R2 + h4 * R3
    let t = 3.0 - r1 * hfx
    let e = hxs * ((r1 - t) / (6.0 - x * t))
    if (k === 0) return x - (x * e - hxs)
    e = x * (e - c) - c
    e -= hxs
    if (k === -1) return 0.5 * (x - e) - 0.5
    if (k === 1) {
      if (x < -0.25) return -2.0 * (e - (x + 0.5))
      return 1.0 + 2.0 * (x - e)
    }
    if (k <= -2 || k > 56) {
      let y = 1.0 - (e - x)
      y = k === 1024 ? y * 2.0 * 2 ** 1023 : y * 2 ** k
      return y - 1.0
    }
    let y: number
    if (k < 20) {
      t = 1 - 2 ** -k
      y = t - (e - x)
      y *= 2 ** k
    } else {
      t = 2 ** -k
      y = x - (e + t)
      y += 1.0
      y *= 2 ** k
    }
    return y
  },
  /** glibc's sinh (fdlibm's), from expm1 and exp. */
  sinh(x: number): number {
    if (!Number.isFinite(x)) return x + x
    const h = x < 0 || Object.is(x, -0) ? -0.5 : 0.5
    const a = Math.abs(x)
    if (a < 22) {
      if (a < 2 ** -28) return x
      const t = libm.expm1(a)
      if (a < 1) return h * (2.0 * t - (t * t) / (t + 1.0))
      return h * (t + t / (t + 1.0))
    }
    if (a < 709.7822265625) return h * libm.exp(a)
    if (a <= 710.4758600739439) {
      const w = libm.exp(0.5 * a)
      const t = h * w
      return t * w
    }
    return x * 1.0e307
  },
  /** glibc's cosh (fdlibm's). */
  cosh(x: number): number {
    const a = Math.abs(x)
    if (a < 22) {
      if (a < 0.3465735912322998) {
        if (a < 2 ** -55) return 1.0
        const t = libm.expm1(a)
        const w = 1.0 + t
        return 1.0 + (t * t) / (w + w)
      }
      const t = libm.exp(a)
      return 0.5 * t + 0.5 / t
    }
    if (a < 709.7822265625) return 0.5 * libm.exp(a)
    if (a <= 710.4758600739439) {
      const w = libm.exp(0.5 * a)
      const t = 0.5 * w
      return t * w
    }
    if (!Number.isFinite(x)) return x * x
    return Infinity
  },
  /** glibc's tanh (fdlibm's). */
  tanh(x: number): number {
    if (!Number.isFinite(x)) return Number.isNaN(x) ? x : x > 0 ? 1.0 : -1.0
    const a = Math.abs(x)
    let z: number
    if (a < 22) {
      if (x === 0) return x
      if (a < 2 ** -55) return x * (1.0 + x)
      if (a >= 1) {
        const t = libm.expm1(2.0 * a)
        z = 1.0 - 2.0 / (t + 2.0)
      } else {
        const t = libm.expm1(-2.0 * a)
        z = -t / (t + 2.0)
      }
    } else z = 1.0 - 1.0e-300
    return x >= 0 && !Object.is(x, -0) ? z : -z
  },
}

const ND = /^\p{Nd}$/u

/** A decimal digit's value: Unicode's digits come in runs of ten from zero. */
export function digitValue(ch: string): number {
  let c = ch.codePointAt(0)!
  let start = c
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--
  return (c - start) % 10
}

/** A str with its Unicode digits as ASCII ones, as `int()` and `float()` read it. */
export const asciiDigits = (s: string): string => Array.from(s, (c) => (c > '\x7f' && ND.test(c) ? String(digitValue(c)) : c)).join('')

/** `float(s)` of a str, or the ValueError it raises. */
export function parseFloatStr(s: string): PyFloat {
  const t = strip(asciiDigits(Array.from(s, (c) => (isspace(c) ? ' ' : c)).join('')))
  const m = /^([+-]?)(?:(inf|infinity)|(nan)|(\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)$/i.exec(t)
  if (!m) throw new PyError(`could not convert string to float: ${reprStr(s)}`)
  if (m[2]) return new PyFloat(m[1] === '-' ? -Infinity : Infinity)
  if (m[3]) return new PyFloat(NaN)
  return new PyFloat(Number(t.replace(/_/g, '')))
}

/** `float(v)` of a JSON value. */
export function toFloat(v: unknown): PyFloat {
  if (v instanceof PyFloat) return v
  if (typeof v === 'number' || typeof v === 'bigint') return new PyFloat(Number(v))
  if (typeof v === 'boolean') return new PyFloat(Number(v))
  if (typeof v === 'string') return parseFloatStr(v)
  throw new PyError(`float() argument must be a string or a real number, not '${pyType(v)}'`)
}

/** `bool(v)`: Python's truthiness. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === '' || v === 0 || v === 0n) return false
  if (v instanceof PyFloat) return v.v !== 0
  if (Array.isArray(v)) return v.length > 0
  if (v instanceof PyDict) return v.size > 0
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return Object.keys(v).length > 0
  if (Buffer.isBuffer(v)) return v.length > 0
  return true
}

/** `int(s)` of a str of digits (regex groups of `\d`), Unicode digits included. */
export const parseIntStr = (s: string): bigint => BigInt(asciiDigits(s))

/** `a / b` of two ints: the exact quotient correctly rounded, as CPython's int true division is. */
export function trueDiv(a: bigint, b: bigint): number {
  if (b === 0n) throw new PyError('division by zero')
  if (a === 0n) return 0
  return toDouble(bdiv(bigInt(a), bigInt(b)))
}
