/**
 * Python's `decimal.Decimal` as the accounting apps (quickbooks, xero, wave)
 * use it: `Decimal(text)`, `+`, `-`, `*`, comparisons, truth and `str()`,
 * in the default context (28 digits, ROUND_HALF_EVEN, InvalidOperation
 * trapped), and each app's `_to_decimal(val)`.
 *
 * The world keeps a Decimal field as Pydantic's JSON writes it, `str(d)`;
 * `stored()` reads one back, and `field()` hands one to `build`/`assign`.
 */
import { PyDecimal } from './models.ts'
import { type PyObject, PyError, isPyObject, str, strip } from './py.ts'
import { Dec } from './query.ts'

const PREC = 28

const invalid = () => new PyError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]")
const syntax = () => new PyError('decimal.InvalidOperation', "[<class 'decimal.ConversionSyntax'>]")

type Kind = 'finite' | 'inf' | 'nan' | 'snan'

export class Decimal implements PyObject {
  readonly pyType = 'Decimal'
  readonly kind: Kind
  readonly negative: boolean
  readonly coef: bigint
  readonly exp: number

  constructor(kind: Kind, negative: boolean, coef = 0n, exp = 0) {
    this.kind = kind
    this.negative = negative
    this.coef = coef
    this.exp = exp
  }

  /** `Decimal(text)`; Python's InvalidOperation (ConversionSyntax) where it raises. */
  static of(text: string): Decimal {
    const d = Dec.parse(text)
    if (d === null) throw syntax()
    return new Decimal(d.kind, d.negative, d.mantissa, d.exp)
  }

  /** `Decimal(n)` for an int. */
  static int(n: number): Decimal {
    return new Decimal('finite', n < 0, BigInt(Math.abs(n)), 0)
  }

  get isNaN(): boolean {
    return this.kind === 'nan' || this.kind === 'snan'
  }

  /** `bool(d)`. */
  truthy(): boolean {
    return this.kind !== 'finite' || this.coef !== 0n
  }

  /** `str(d)`: Python's `__str__` (to-scientific-string). */
  toString(): string {
    const sign = this.negative ? '-' : ''
    if (this.kind === 'inf') return `${sign}Infinity`
    if (this.kind === 'nan') return `${sign}NaN`
    if (this.kind === 'snan') return `${sign}sNaN`
    const digits = this.coef.toString()
    const leftdigits = this.exp + digits.length
    const dotplace = this.exp <= 0 && leftdigits > -6 ? leftdigits : 1
    let intpart: string
    let fracpart: string
    if (dotplace <= 0) {
      intpart = '0'
      fracpart = `.${'0'.repeat(-dotplace)}${digits}`
    } else if (dotplace >= digits.length) {
      intpart = digits + '0'.repeat(dotplace - digits.length)
      fracpart = ''
    } else {
      intpart = digits.slice(0, dotplace)
      fracpart = `.${digits.slice(dotplace)}`
    }
    const e = leftdigits - dotplace
    const exp = e === 0 ? '' : `E${e > 0 ? '+' : '-'}${Math.abs(e)}`
    return sign + intpart + fracpart + exp
  }

  pyStr(): string {
    return this.toString()
  }

  pyRepr(): string {
    return `Decimal('${this.toString()}')`
  }

  /** A NaN operand's result, as `_check_nans` gives it; null where none is a NaN. */
  private nans(other: Decimal): Decimal | null {
    if (this.kind === 'snan' || other.kind === 'snan') throw invalid()
    if (this.kind === 'nan') return this
    if (other.kind === 'nan') return other
    return null
  }

  neg(): Decimal {
    if (this.isNaN) {
      if (this.kind === 'snan') throw invalid()
      return this
    }
    return new Decimal(this.kind, this.kind === 'finite' && this.coef === 0n ? false : !this.negative, this.coef, this.exp)
  }

  add(other: Decimal): Decimal {
    const nan = this.nans(other)
    if (nan !== null) return nan
    if (this.kind === 'inf') {
      if (other.kind === 'inf' && other.negative !== this.negative) throw invalid()
      return this
    }
    if (other.kind === 'inf') return other
    const exp = Math.min(this.exp, other.exp)
    const a = (this.negative ? -this.coef : this.coef) * 10n ** BigInt(this.exp - exp)
    const b = (other.negative ? -other.coef : other.coef) * 10n ** BigInt(other.exp - exp)
    const sum = a + b
    if (sum === 0n) return new Decimal('finite', this.negative && other.negative, 0n, exp)
    return round(sum < 0n, sum < 0n ? -sum : sum, exp)
  }

  sub(other: Decimal): Decimal {
    if (other.kind === 'snan' || this.kind === 'snan') throw invalid()
    return this.add(other.isNaN ? other : other.kind === 'finite' && other.coef === 0n ? new Decimal('finite', !other.negative, 0n, other.exp) : other.neg())
  }

  mul(other: Decimal): Decimal {
    const nan = this.nans(other)
    if (nan !== null) return nan
    const negative = this.negative !== other.negative
    if (this.kind === 'inf' || other.kind === 'inf') {
      const zero = (d: Decimal) => d.kind === 'finite' && d.coef === 0n
      if (zero(this) || zero(other)) throw invalid()
      return new Decimal('inf', negative)
    }
    return round(negative, this.coef * other.coef, this.exp + other.exp)
  }

  /** Ordering, as `<`, `>`: a NaN raises InvalidOperation. */
  compare(other: Decimal): number {
    if (this.isNaN || other.isNaN) throw invalid()
    const rank = (d: Decimal) => (d.kind === 'inf' ? (d.negative ? -2 : 2) : d.coef === 0n ? 0 : d.negative ? -1 : 1)
    const ra = rank(this)
    const rb = rank(other)
    if (ra !== rb || Math.abs(ra) !== 1) return Math.sign(ra - rb)
    const e = Math.min(this.exp, other.exp)
    const ma = this.coef * 10n ** BigInt(this.exp - e)
    const mb = other.coef * 10n ** BigInt(other.exp - e)
    const c = ma === mb ? 0 : ma < mb ? -1 : 1
    return ra < 0 ? -c : c
  }

  /** `==`: a quiet NaN is unequal, a signaling one raises. */
  eq(other: Decimal): boolean {
    if (this.kind === 'snan' || other.kind === 'snan') throw invalid()
    if (this.isNaN || other.isNaN) return false
    return this.compare(other) === 0
  }
}

/** A finite result rounded to the context's 28 digits, half to even. */
function round(negative: boolean, coef: bigint, exp: number): Decimal {
  let digits = coef.toString().length
  if (digits <= PREC) return new Decimal('finite', negative, coef, exp)
  const shift = digits - PREC
  const p = 10n ** BigInt(shift)
  let q = coef / p
  const r = coef % p
  const half = p / 2n
  if (r > half || (r === half && q % 2n === 1n)) q += 1n
  let e = exp + shift
  digits = q.toString().length
  if (digits > PREC) {
    q /= 10n
    e += 1
  }
  return new Decimal('finite', negative, q, e)
}

/** `max(a, b)`: `b` only where `b > a`. */
export function maxDec(a: Decimal, b: Decimal): Decimal {
  return b.compare(a) > 0 ? b : a
}

/** `_to_decimal(val)`: `Decimal("0")` for None, else `Decimal(str(val)` less `,` and `$`, stripped`)`. */
export function toDecimal(val: unknown): Decimal {
  if (val === null || val === undefined) return Decimal.of('0')
  return Decimal.of(strip(str(val).split(',').join('').split('$').join('')))
}

/** A stored Decimal field (`str(d)`), or a Decimal already. */
export function stored(value: unknown): Decimal {
  if (value instanceof Decimal) return value
  if (value instanceof PyDecimal) return Decimal.of(value.text)
  if (typeof value === 'string') return Decimal.of(value)
  if (isPyObject(value)) return Decimal.of(value.pyStr())
  throw new Error(`not a stored Decimal: ${String(value)}`)
}

/** A Decimal as `build`/`assign` take one. */
export function field(d: Decimal): PyDecimal {
  return new PyDecimal(d.toString())
}
