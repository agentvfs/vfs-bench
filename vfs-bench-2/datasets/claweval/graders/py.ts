/**
 * Python semantics for the TypeScript port of Claw-Eval's graders
 * (`build.py` writes `port/` against this module).
 *
 * The port keeps upstream's code as written, so what its values do is
 * Python's: truthiness, `==` on lists and dicts, dicts ordered by insertion
 * whatever their keys, strings indexed by code point, `re` patterns,
 * `json.dumps`, `round` and `%`-free number formatting. A Python `int` and
 * `float` are both a JavaScript number; where the two print differently
 * (`1` and `1.0`) the port says which it has (`strFloat`).
 */
import { round as pyRound, strip as pyStrip, lines as pyLines } from '../../../workspace/grader.ts'

// ---------------------------------------------------------------- exceptions

/** Python's BaseException: an `except Exception` does not catch it. */
export class BaseException extends Error {
  args: any[]
  constructor(...args: any[]) {
    super(args.length ? String(args[0]) : '')
    this.args = args
    this.name = new.target.name
  }
  toString() {
    return this.args.length === 1 ? str(this.args[0]) : this.args.length ? repr(tuple(...this.args)) : ''
  }
}
export class Exception extends BaseException {}
export class ValueError extends Exception {}
export class TypeError_ extends Exception {}
export class KeyError extends Exception {
  toString() {
    return this.args.length === 1 ? repr(this.args[0]) : super.toString()
  }
}
export class IndexError extends Exception {}
export class AttributeError extends Exception {}
export class ZeroDivisionError extends Exception {}
export class RuntimeError extends Exception {}
export class FileNotFoundError extends Exception {}
export class ImportError extends Exception {}
export class StopIteration extends Exception {}
export class JSONDecodeError extends ValueError {
  msg: string
  doc: string
  pos: number
  lineno: number
  colno: number
  constructor(msg: string, doc: string, pos: number) {
    // CPython's: the line, and the column after the line's last newline.
    const before = cpSlice(doc, 0, pos)
    const lineno = (before.match(/\n/g)?.length ?? 0) + 1
    const lineStart = cpLen(before.slice(0, before.lastIndexOf('\n') + 1))
    const colno = pos - lineStart + 1
    super(`${msg}: line ${lineno} column ${colno} (char ${pos})`)
    this.msg = msg
    this.doc = doc
    this.pos = pos
    this.lineno = lineno
    this.colno = colno
  }
}
Object.defineProperty(TypeError_, 'name', { value: 'TypeError' })

/** A thrown value as Python sees it: JavaScript's own errors are Python's
 * AttributeError (a missing attribute's lookup) or TypeError. */
export function exc(error: unknown): BaseException {
  if (error instanceof BaseException) return error
  if (error instanceof TypeError) return new AttributeError(error.message)
  if (error instanceof RangeError) return new RuntimeError(error.message)
  return new Exception(error instanceof Error ? error.message : String(error))
}
/** Whether `error` is an instance of one of `classes` (an except clause). */
export function caught(error: BaseException, classes: any[]): boolean {
  return classes.some((c) => {
    if (c === BaseException) return true
    const mapped = c === TypeError_ ? TypeError_ : c
    return error instanceof mapped
  })
}

// ---------------------------------------------------------------- containers

/** A Python dict: insertion-ordered, keyed by Python equality. */
export class PyDict {
  map = new Map<any, [any, any]>()
  constructor(entries?: Iterable<[any, any]>) {
    if (entries) for (const [k, v] of entries) this.set(k, v)
  }
  set(k: any, v: any) {
    const h = hashKey(k)
    const old = this.map.get(h)
    if (old) old[1] = v
    else this.map.set(h, [k, v])
  }
  has(k: any) {
    return this.map.has(hashKey(k))
  }
  lookup(k: any): [any, any] | undefined {
    return this.map.get(hashKey(k))
  }
  delete(k: any) {
    return this.map.delete(hashKey(k))
  }
  get size() {
    return this.map.size
  }
  *keys() {
    for (const [k] of this.map.values()) yield k
  }
  *values() {
    for (const [, v] of this.map.values()) yield v
  }
  *entries(): Generator<[any, any]> {
    for (const e of this.map.values()) yield e
  }
}
/** A Python set, ordered by insertion (where CPython's string sets are
 * ordered by a per-process hash). */
export class PySet {
  map = new Map<any, any>()
  constructor(items?: Iterable<any>) {
    if (items) for (const v of items) this.add(v)
  }
  add(v: any) {
    const h = hashKey(v)
    if (!this.map.has(h)) this.map.set(h, v)
  }
  has(v: any) {
    return this.map.has(hashKey(v))
  }
  delete(v: any) {
    return this.map.delete(hashKey(v))
  }
  get size() {
    return this.map.size
  }
  values() {
    return this.map.values()
  }
}
/** A Python tuple: an array that compares and prints as one. */
export class PyTuple extends Array<any> {}
export function tuple(...items: any[]): PyTuple {
  const t = new PyTuple()
  t.push(...items)
  return t
}
const TUPLE = '\ufdd0t'
function hashKey(k: any): any {
  if (k === undefined) return null
  if (k === true) return 1
  if (k === false) return 0
  if (k instanceof PyTuple) return TUPLE + JSON.stringify(k.map(hashKey))
  if (Array.isArray(k) || k instanceof PyDict || k instanceof PySet)
    throw new TypeError_(`unhashable type: '${typeName(k)}'`)
  return k
}

/** Keyword arguments at a call: `f(a, kw({b: 1}))` is `f(a, b=1)`. */
export class Kw {
  readonly values: Record<string, any>
  constructor(values: Record<string, any>) {
    this.values = values
  }
}
export const kw = (values: Record<string, any>) => new Kw(values)
/** `f(**d)`: a dict's items as keywords. */
export function kwargs(d: any): Record<string, any> {
  if (!(d instanceof PyDict)) throw new TypeError_('argument after ** must be a mapping')
  return Object.fromEntries([...d.entries()].map(([k, v]) => [str(k), v]))
}
/** A call's arguments bound to `names`, Python's way: `defaults` are the
 * last parameters' (as evaluated at the definition), `star` collects extra
 * positionals, `kwonly` names keyword-only parameters, `dstar` extra
 * keywords (as a dict). */
export function bind(
  args: any[],
  names: string[],
  defaults: any[] = [],
  options: { star?: boolean; kwonly?: [string, any][]; dstar?: boolean } = {}
): any[] {
  let keywords: Record<string, any> = {}
  if (args.length && args[args.length - 1] instanceof Kw) {
    keywords = { ...(args[args.length - 1] as Kw).values }
    args = args.slice(0, -1)
  }
  const out: any[] = []
  const first = names.length - defaults.length
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    if (i < args.length) {
      if (Object.hasOwn(keywords, name)) throw new TypeError_(`got multiple values for argument '${name}'`)
      out.push(args[i])
    } else if (Object.hasOwn(keywords, name)) {
      out.push(keywords[name])
      delete keywords[name]
    } else if (i >= first) out.push(defaults[i - first])
    else throw new TypeError_(`missing a required argument: '${name}'`)
  }
  const extra = args.slice(names.length)
  if (options.star) out.push(extra)
  else if (extra.length) throw new TypeError_(`takes ${names.length} positional arguments but ${args.length} were given`)
  for (const [name, fallback] of options.kwonly ?? []) {
    if (Object.hasOwn(keywords, name)) {
      out.push(keywords[name])
      delete keywords[name]
    } else if (fallback === REQUIRED) throw new TypeError_(`missing a required keyword argument: '${name}'`)
    else out.push(fallback)
  }
  if (options.dstar) out.push(new PyDict(Object.entries(keywords)))
  else if (Object.keys(keywords).length)
    throw new TypeError_(`got an unexpected keyword argument '${Object.keys(keywords)[0]}'`)
  return out
}
export const REQUIRED = Symbol('required')
/** A call's own positionals and keywords, for a callee with none bound. */
function split(args: any[]): [any[], Record<string, any>] {
  if (args.length && args[args.length - 1] instanceof Kw)
    return [args.slice(0, -1), (args[args.length - 1] as Kw).values]
  return [args, {}]
}

// ---------------------------------------------------------------- strings

const SURROGATE = /[\uD800-\uDFFF]/
export function cpLen(s: string): number {
  if (!SURROGATE.test(s)) return s.length
  let n = 0
  for (const _ of s) n++
  return n
}
function cpArray(s: string): string[] {
  return SURROGATE.test(s) ? [...s] : s.split('')
}
export function cpSlice(s: string, a: number, b?: number): string {
  if (!SURROGATE.test(s)) return s.slice(a, b)
  return [...s].slice(a, b).join('')
}
/** The code point index of UTF-16 index `i` in `s`. */
function cpIndex(s: string, i: number): number {
  if (!SURROGATE.test(s)) return i
  return cpLen(s.slice(0, i))
}
/** The UTF-16 index of code point index `i` in `s`. */
function utf16Index(s: string, i: number): number {
  if (!SURROGATE.test(s)) return i
  let n = 0,
    j = 0
  for (const ch of s) {
    if (n === i) return j
    n++
    j += ch.length
  }
  return s.length
}
const WHITESPACE = /[\t-\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/
function isSpace(ch: string) {
  return WHITESPACE.test(ch)
}

/** Python's repr of a string: single quotes unless it holds one and no
 * double quote, escapes for what is not printable. */
export function reprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = quote
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === quote || ch === '\\') out += '\\' + ch
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0')
    else if (!printable(ch)) {
      if (c < 0x100) out += '\\x' + c.toString(16).padStart(2, '0')
      else if (c < 0x10000) out += '\\u' + c.toString(16).padStart(4, '0')
      else out += '\\U' + c.toString(16).padStart(8, '0')
    } else out += ch
  }
  return out + quote
}
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u
function printable(ch: string) {
  return ch === ' ' || !UNPRINTABLE.test(ch)
}

/** Python's repr of a float: the shortest digits that read back. */
export function reprFloat(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (x === Infinity) return 'inf'
  if (x === -Infinity) return '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const [mantissa, e] = x.toExponential().split('e')
  const exponent = Number(e)
  const negative = mantissa!.startsWith('-')
  const digits = mantissa!.replace('-', '').replace('.', '')
  let out: string
  if (exponent >= -5 && exponent < 16) {
    if (exponent < 0) out = '0.' + '0'.repeat(-exponent - 1) + digits
    else if (digits.length <= exponent + 1) out = digits + '0'.repeat(exponent + 1 - digits.length) + '.0'
    else out = digits.slice(0, exponent + 1) + '.' + digits.slice(exponent + 1)
  } else {
    out =
      (digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits) +
      'e' +
      (exponent < 0 ? '-' : '+') +
      String(Math.abs(exponent)).padStart(2, '0')
  }
  return (negative ? '-' : '') + out
}
function reprInt(x: number): string {
  if (Number.isSafeInteger(x)) return String(x)
  return BigInt(x).toString()
}

/** `str(x)`. */
export function str(x: any = ''): string {
  if (typeof x === 'string') return x
  return reprOf(x, false)
}
/** `str(x)` where the port knows `x` is a float. */
export function strFloat(x: any): string {
  return typeof x === 'number' ? reprFloat(x) : str(x)
}
export function repr(x: any): string {
  return reprOf(x, true)
}
function reprOf(x: any, quoted: boolean): string {
  if (x === null || x === undefined) return 'None'
  if (x === true) return 'True'
  if (x === false) return 'False'
  if (typeof x === 'string') return quoted ? reprStr(x) : x
  if (typeof x === 'number') return Number.isInteger(x) ? reprInt(x) : reprFloat(x)
  if (x instanceof PyTuple) return x.length === 1 ? `(${repr(x[0])},)` : `(${x.map(repr).join(', ')})`
  if (Array.isArray(x)) return `[${x.map(repr).join(', ')}]`
  if (x instanceof PyDict) return `{${[...x.entries()].map(([k, v]) => `${repr(k)}: ${repr(v)}`).join(', ')}}`
  if (x instanceof PySet) return x.size ? `{${[...x.values()].map(repr).join(', ')}}` : 'set()'
  if (x instanceof BaseException) return quoted ? `${x.name}(${x.args.map(repr).join(', ')})` : x.toString()
  if (typeof x.__repr__ === 'function') return x.__repr__()
  if (typeof x.__str__ === 'function') return x.__str__()
  return `<${x?.constructor?.name ?? 'object'} object>`
}

// ---------------------------------------------------------------- formatting

/** CPython's fixed-point formatting: exact on the binary value, ties to even. */
function fixed(x: number, precision: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf'
  const negative = x < 0 || Object.is(x, -0)
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, Math.abs(x))
  const bits = buf.getBigUint64(0)
  const exponent = Number((bits >> 52n) & 2047n)
  let numerator = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)
  let denominator = 1n
  const shift = (exponent || 1) - 1023 - 52
  if (shift >= 0) numerator <<= BigInt(shift)
  else denominator <<= BigInt(-shift)
  numerator *= 10n ** BigInt(precision)
  let q = numerator / denominator
  const r = numerator % denominator
  if (r * 2n > denominator || (r * 2n === denominator && q % 2n === 1n)) q++
  let digits = q.toString().padStart(precision + 1, '0')
  if (precision) digits = digits.slice(0, -precision) + '.' + digits.slice(-precision)
  return (negative ? '-' : '') + digits
}
/** `format(value, spec)`: Python's format-spec mini-language. */
export function format(value: any, spec = ''): string {
  if (typeof value?.__format__ === 'function') return value.__format__(spec)
  const m = /^(?:(.)?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/su.exec(spec)
  if (!m) throw new ValueError(`Invalid format specifier '${spec}'`)
  let [, fill, align, sign, , , zero, width, group, precision, type] = m
  let body: string
  if (zero && !align) {
    fill = '0'
    align = '='
  }
  const number = typeof value === 'number' || typeof value === 'boolean'
  if (!number) {
    if (type && type !== 's') throw new ValueError(`Unknown format code '${type}' for object of type '${typeName(value)}'`)
    body = str(value)
    if (precision !== undefined) body = cpSlice(body, 0, Number(precision))
    align ||= '<'
  } else {
    const x = Number(value)
    let digits: string
    if (type === 'f' || type === 'F') digits = fixed(x, precision === undefined ? 6 : Number(precision))
    else if (type === '%') digits = fixed(x * 100, precision === undefined ? 6 : Number(precision)) + '%'
    else if (type === 'd') digits = reprInt(x)
    else if (type === 'e' || type === 'E') {
      const p = precision === undefined ? 6 : Number(precision)
      const [mm, ee] = x.toExponential(p).split('e')
      digits = mm + 'e' + (Number(ee) < 0 ? '-' : '+') + String(Math.abs(Number(ee))).padStart(2, '0')
      if (type === 'E') digits = digits.toUpperCase()
    } else if (type === 'g' || type === 'G' || (!type && precision !== undefined)) {
      const p = precision === undefined ? 6 : Math.max(Number(precision), 1)
      const exp = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(Number(x.toPrecision(p)))))
      if (exp >= -4 && exp < p) digits = fixed(x, p - 1 - exp)
      else digits = format(x, `.${p - 1}e`)
      if (!m[5]) digits = digits.replace(/(\.\d*?)0+(?=$|e)/, '$1').replace(/\.(?=$|e)/, '')
      if (!type && !digits.includes('.') && !digits.includes('e') && !Number.isInteger(x)) digits += '.0'
    } else digits = str(x)
    if (group) {
      const [int, frac] = digits.replace('-', '').split('.')
      const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, group)
      digits = (digits.startsWith('-') ? '-' : '') + grouped + (frac !== undefined ? '.' + frac : '')
    }
    const negative = digits.startsWith('-')
    if (negative) digits = digits.slice(1)
    const signText = negative ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : ''
    if (align === '=') {
      const pad = Math.max(0, Number(width ?? 0) - signText.length - cpLen(digits))
      return signText + (fill ?? ' ').repeat(pad) + digits
    }
    body = signText + digits
    align ||= '>'
  }
  const pad = Math.max(0, Number(width ?? 0) - cpLen(body))
  const f = fill ?? ' '
  if (align === '<') return body + f.repeat(pad)
  if (align === '>') return f.repeat(pad) + body
  if (align === '^') return f.repeat(Math.floor(pad / 2)) + body + f.repeat(pad - Math.floor(pad / 2))
  return body
}
/** An f-string's `{value!conversion:spec}`. */
export function fv(value: any, spec?: string, conversion?: 'r' | 's' | 'a'): string {
  if (conversion === 'r') value = repr(value)
  else if (conversion === 's') value = str(value)
  return spec ? format(value, spec) : str(value)
}

// ---------------------------------------------------------------- operators

export function t(x: any): boolean {
  if (x === null || x === undefined || x === false || x === 0 || x === '' || Number.isNaN(x)) return false
  if (Array.isArray(x)) return x.length > 0
  if (x instanceof PyDict || x instanceof PySet) return x.size > 0
  if (typeof x?.__bool__ === 'function') return x.__bool__()
  if (typeof x?.__len__ === 'function') return x.__len__() > 0
  return true
}
export const or = (a: any, b: () => any) => (t(a) ? a : b())
export const and = (a: any, b: () => any) => (t(a) ? b() : a)
export const not = (a: any) => !t(a)

export function eq(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === 'boolean') a = Number(a)
  if (typeof b === 'boolean') b = Number(b)
  if (typeof a === 'number' || typeof b === 'number') return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a instanceof PyTuple !== b instanceof PyTuple) return false
    return a.length === b.length && a.every((v, i) => eq(v, b[i]))
  }
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.size !== b.size) return false
    for (const [k, v] of a.entries()) {
      const other = b.lookup(k)
      if (!other || !eq(v, other[1])) return false
    }
    return true
  }
  if (a instanceof PySet && b instanceof PySet) return a.size === b.size && [...a.values()].every((v) => b.has(v))
  if (typeof a?.__eq__ === 'function') return a.__eq__(b)
  return false
}
export const ne = (a: any, b: any) => !eq(a, b)
/** Python's ordering: numbers, strings by code point, sequences in turn. */
export function cmp(a: any, b: any): number {
  if (typeof a === 'boolean') a = Number(a)
  if (typeof b === 'boolean') b = Number(b)
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') {
    if (!SURROGATE.test(a) && !SURROGATE.test(b)) return a < b ? -1 : a > b ? 1 : 0
    const aa = [...a],
      bb = [...b]
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      const d = aa[i]!.codePointAt(0)! - bb[i]!.codePointAt(0)!
      if (d) return d < 0 ? -1 : 1
    }
    return aa.length - bb.length < 0 ? -1 : aa.length > bb.length ? 1 : 0
  }
  if (Array.isArray(a) && Array.isArray(b) && a instanceof PyTuple === b instanceof PyTuple) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (!eq(a[i], b[i])) return cmp(a[i], b[i])
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
  }
  if (a instanceof PySet && b instanceof PySet) {
    if (eq(a, b)) return 0
    if ([...a.values()].every((v) => b.has(v))) return -1
    if ([...b.values()].every((v) => a.has(v))) return 1
    return NaN
  }
  if (typeof a?.__lt__ === 'function') return a.__lt__(b) ? -1 : b.__lt__?.(a) ? 1 : 0
  throw new TypeError_(`'<' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`)
}
export const lt = (a: any, b: any) => cmp(a, b) < 0
export const le = (a: any, b: any) => cmp(a, b) <= 0
export const gt = (a: any, b: any) => cmp(a, b) > 0
export const ge = (a: any, b: any) => cmp(a, b) >= 0
export function in_(item: any, container: any): boolean {
  if (typeof container === 'string') {
    if (typeof item !== 'string') throw new TypeError_(`'in <string>' requires string as left operand, not ${typeName(item)}`)
    return container.includes(item)
  }
  if (Array.isArray(container)) return container.some((v) => v === item || eq(v, item))
  if (container instanceof PyDict) return container.has(item)
  if (container instanceof PySet) return container.has(item)
  if (container && typeof container.__contains__ === 'function') return container.__contains__(item)
  for (const v of iter(container)) if (eq(v, item)) return true
  return false
}
export const notIn = (item: any, container: any) => !in_(item, container)

function number(x: any): number {
  if (typeof x === 'boolean') return Number(x)
  return x
}
export function add(a: any, b: any): any {
  if (typeof a === 'string' && typeof b === 'string') return a + b
  if ((typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean'))
    return number(a) + number(b)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a instanceof PyTuple && b instanceof PyTuple) return tuple(...a, ...b)
    if (!(a instanceof PyTuple) && !(b instanceof PyTuple)) return [...a, ...b]
  }
  if (typeof a?.__add__ === 'function') return a.__add__(b)
  throw new TypeError_(`unsupported operand type(s) for +: '${typeName(a)}' and '${typeName(b)}'`)
}
/** `a += b`: a list extends in place. */
export function iadd(a: any, b: any): any {
  if (Array.isArray(a) && !(a instanceof PyTuple)) {
    a.push(...iter(b))
    return a
  }
  return add(a, b)
}
export function sub(a: any, b: any): any {
  if (a instanceof PySet && b instanceof PySet) return new PySet([...a.values()].filter((v) => !b.has(v)))
  if (typeof a?.__sub__ === 'function') return a.__sub__(b)
  checkNumbers(a, b, '-')
  return number(a) - number(b)
}
export function mul(a: any, b: any): any {
  if (typeof a === 'string' && typeof b === 'number') return b > 0 ? a.repeat(b) : ''
  if (typeof b === 'string' && typeof a === 'number') return a > 0 ? b.repeat(a) : ''
  if (Array.isArray(a) && typeof b === 'number') return Array.from({ length: Math.max(0, b) }, () => a).flat()
  checkNumbers(a, b, '*')
  return number(a) * number(b)
}
export function div(a: any, b: any): number {
  checkNumbers(a, b, '/')
  if (number(b) === 0) throw new ZeroDivisionError('division by zero')
  return number(a) / number(b)
}
export function floordiv(a: any, b: any): number {
  checkNumbers(a, b, '//')
  if (number(b) === 0) throw new ZeroDivisionError('integer division or modulo by zero')
  return Math.floor(number(a) / number(b))
}
export function mod(a: any, b: any): number {
  checkNumbers(a, b, '%')
  if (number(b) === 0) throw new ZeroDivisionError('integer modulo by zero')
  const r = number(a) % number(b)
  return r !== 0 && r < 0 !== number(b) < 0 ? r + number(b) : r
}
export function pow(a: any, b: any): number {
  checkNumbers(a, b, '**')
  return number(a) ** number(b)
}
export function neg(a: any): number {
  checkNumbers(a, 0, '-')
  return -number(a)
}
export function bitor(a: any, b: any): any {
  if (a instanceof PySet && b instanceof PySet) return new PySet([...a.values(), ...b.values()])
  if (a instanceof PyDict && b instanceof PyDict) return new PyDict([...a.entries(), ...b.entries()])
  return number(a) | number(b)
}
export function bitand(a: any, b: any): any {
  if (a instanceof PySet && b instanceof PySet) return new PySet([...a.values()].filter((v) => b.has(v)))
  return number(a) & number(b)
}
function checkNumbers(a: any, b: any, op: string) {
  const ok = (x: any) => typeof x === 'number' || typeof x === 'boolean'
  if (!ok(a) || !ok(b))
    throw new TypeError_(`unsupported operand type(s) for ${op}: '${typeName(a)}' and '${typeName(b)}'`)
}

// ---------------------------------------------------------------- items

function index(length: number, i: any): number {
  const n = number(i)
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new TypeError_('indices must be integers')
  return n < 0 ? n + length : n
}
/** `x[k]`. */
export function gi(x: any, k: any): any {
  if (typeof x === 'string') {
    const chars = cpArray(x)
    const i = index(chars.length, k)
    if (i < 0 || i >= chars.length) throw new IndexError('string index out of range')
    return chars[i]
  }
  if (Array.isArray(x)) {
    const i = index(x.length, k)
    if (i < 0 || i >= x.length) throw new IndexError(`${x instanceof PyTuple ? 'tuple' : 'list'} index out of range`)
    return x[i]
  }
  if (x instanceof PyDict) {
    const e = x.lookup(k)
    if (!e) throw new KeyError(k)
    return e[1]
  }
  if (x && typeof x.__getitem__ === 'function') return x.__getitem__(k)
  if (x == null) throw new TypeError_("'NoneType' object is not subscriptable")
  throw new TypeError_(`'${typeName(x)}' object is not subscriptable`)
}
/** `x[k] = v`. */
export function si(x: any, k: any, v: any): void {
  if (Array.isArray(x) && !(x instanceof PyTuple)) {
    const i = index(x.length, k)
    if (i < 0 || i >= x.length) throw new IndexError('list assignment index out of range')
    x[i] = v
  } else if (x instanceof PyDict) x.set(k, v)
  else throw new TypeError_(`'${typeName(x)}' object does not support item assignment`)
}
/** `del x[k]`. */
export function di(x: any, k: any): void {
  if (Array.isArray(x)) x.splice(index(x.length, k), 1)
  else if (x instanceof PyDict) {
    if (!x.delete(k)) throw new KeyError(k)
  } else throw new TypeError_(`'${typeName(x)}' object does not support item deletion`)
}
function sliceIndices(length: number, lo: any, hi: any, step: any): number[] {
  const s = step == null ? 1 : number(step)
  if (s === 0) throw new ValueError('slice step cannot be zero')
  const clamp = (v: any, dflt: number, low: number, high: number) => {
    if (v == null) return dflt
    let n = number(v)
    if (n < 0) n += length
    return Math.min(Math.max(n, low), high)
  }
  const out: number[] = []
  if (s > 0) {
    const a = clamp(lo, 0, 0, length),
      b = clamp(hi, length, 0, length)
    for (let i = a; i < b; i += s) out.push(i)
  } else {
    const a = clamp(lo, length - 1, -1, length - 1),
      b = clamp(hi, -1, -1, length - 1)
    for (let i = a; i > b; i += s) out.push(i)
  }
  return out
}
/** `x[lo:hi:step]`. */
export function sl(x: any, lo?: any, hi?: any, step?: any): any {
  if (typeof x === 'string') {
    if ((step == null || step === 1) && !SURROGATE.test(x)) {
      const n = x.length
      const norm = (v: any, d: number) => (v == null ? d : v < 0 ? Math.max(0, v + n) : Math.min(v, n))
      const a = norm(lo, 0),
        b = norm(hi, n)
      return a < b ? x.slice(a, b) : ''
    }
    const chars = cpArray(x)
    return sliceIndices(chars.length, lo, hi, step)
      .map((i) => chars[i])
      .join('')
  }
  if (Array.isArray(x)) {
    const items = sliceIndices(x.length, lo, hi, step).map((i) => x[i])
    return x instanceof PyTuple ? tuple(...items) : items
  }
  throw new TypeError_(`'${typeName(x)}' object is not subscriptable`)
}
/** `a, b = x`. */
export function unpack(x: any, n: number): any[] {
  const items = [...iter(x)]
  if (items.length !== n)
    throw new ValueError(
      items.length > n ? `too many values to unpack (expected ${n})` : `not enough values to unpack (expected ${n}, got ${items.length})`
    )
  return items
}

// ---------------------------------------------------------------- builtins

export function iter(x: any): Iterable<any> {
  if (Array.isArray(x)) return x
  if (typeof x === 'string') return cpArray(x)
  if (x instanceof PyDict) return [...x.keys()]
  if (x instanceof PySet) return [...x.values()]
  if (x && typeof x[Symbol.iterator] === 'function') return x
  throw new TypeError_(`'${typeName(x)}' object is not iterable`)
}
export function len(x: any): number {
  if (typeof x === 'string') return cpLen(x)
  if (Array.isArray(x)) return x.length
  if (x instanceof PyDict || x instanceof PySet) return x.size
  if (x && typeof x.__len__ === 'function') return x.__len__()
  throw new TypeError_(`object of type '${typeName(x)}' has no len()`)
}
export function typeName(x: any): string {
  if (x === null || x === undefined) return 'NoneType'
  if (typeof x === 'boolean') return 'bool'
  if (typeof x === 'number') return Number.isInteger(x) ? 'int' : 'float'
  if (typeof x === 'string') return 'str'
  if (x instanceof PyTuple) return 'tuple'
  if (Array.isArray(x)) return 'list'
  if (x instanceof PyDict) return 'dict'
  if (x instanceof PySet) return 'set'
  if (typeof x === 'function') return 'function'
  return x.constructor?.name ?? 'object'
}
/** `type(x)`: what the port reads of it is its `__name__`. */
export function type(x: any) {
  return { __name__: typeName(x) }
}
export function print(...args: any[]) {
  const [values, options] = split(args)
  const sep = options.sep ?? ' ',
    end = options.end ?? '\n'
  stdout.push(values.map((v) => str(v)).join(sep) + end)
}
/** What the grade printed. */
export const stdout: string[] = []

export function int(x: any = 0, base?: any): number {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new ValueError('cannot convert float to integer')
    return Math.trunc(x)
  }
  if (typeof x === 'boolean') return Number(x)
  if (typeof x === 'string') {
    const s = pyStrip(x).replace(/_/g, '')
    const b = base == null ? 10 : number(base)
    const ok = b === 10 ? /^[+-]?\d+$/.test(s) : /^[+-]?[0-9a-z]+$/i.test(s)
    if (!ok) throw new ValueError(`invalid literal for int() with base ${b}: ${reprStr(x)}`)
    return parseInt(s, b)
  }
  if (x && typeof x.__int__ === 'function') return x.__int__()
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${typeName(x)}'`)
}
export function float(x: any = 0): number {
  if (typeof x === 'number') return x
  if (typeof x === 'boolean') return Number(x)
  if (typeof x === 'string') {
    const s = pyStrip(x).toLowerCase()
    if (/^[+-]?(inf|infinity)$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity
    if (/^[+-]?nan$/.test(s)) return NaN
    if (/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)(e[+-]?\d(_?\d)*)?$/.test(s)) return Number(s.replace(/_/g, ''))
    throw new ValueError(`could not convert string to float: ${reprStr(x)}`)
  }
  if (x && typeof x.__float__ === 'function') return x.__float__()
  throw new TypeError_(`float() argument must be a string or a real number, not '${typeName(x)}'`)
}
export const bool = (x: any = false) => t(x)
export function list(x?: any): any[] {
  return x === undefined ? [] : [...iter(x)]
}
export function set(x?: any): PySet {
  return new PySet(x === undefined ? [] : iter(x))
}
export function frozenset(x?: any): PySet {
  return set(x)
}
export function dict(...args: any[]): PyDict {
  const [values, keywords] = split(args)
  const d = new PyDict()
  if (values.length) {
    const source = values[0]
    if (source instanceof PyDict) for (const [k, v] of source.entries()) d.set(k, v)
    else for (const item of iter(source)) {
      const [k, v] = unpack(item, 2)
      d.set(k, v)
    }
  }
  for (const [k, v] of Object.entries(keywords)) d.set(k, v)
  return d
}
dict.fromkeys = (keys: any, value: any = null) => new PyDict([...iter(keys)].map((k) => [k, value]))
export function tupleOf(x?: any): PyTuple {
  return x === undefined ? tuple() : tuple(...iter(x))
}
export function* range(a: number, b?: number, step = 1) {
  if (b === undefined) [a, b] = [0, a]
  if (step > 0) for (let i = a; i < b; i += step) yield i
  else for (let i = a; i > b; i += step) yield i
}
export function* enumerate(x: any, start = 0) {
  let i = start
  for (const v of iter(x)) yield tuple(i++, v)
}
export function* zip(...xs: any[]) {
  const its = xs.map((x) => iter(x)[Symbol.iterator]())
  if (!its.length) return
  for (;;) {
    const row = its.map((it) => it.next())
    if (row.some((r) => r.done)) return
    yield tuple(...row.map((r) => r.value))
  }
}
export function reversed(x: any): any[] {
  return [...iter(x)].reverse()
}
export function sorted(...args: any[]): any[] {
  const [[x], options] = split(args)
  const items = [...iter(x)]
  sortInPlace(items, options.key, options.reverse)
  return items
}
function sortInPlace(items: any[], key?: any, reverse?: any) {
  const keys = new Map<any, any>()
  const keyOf = (v: any, i: number) => (key ? keys.get(i) : v)
  const indexed = items.map((v, i) => [v, i] as [any, number])
  if (key) indexed.forEach(([v, i]) => keys.set(i, key(v)))
  indexed.sort((a, b) => {
    const c = cmp(keyOf(a[0], a[1]), keyOf(b[0], b[1]))
    return t(reverse) ? -c : c
  })
  indexed.forEach(([v], i) => (items[i] = v))
}
function extreme(args: any[], sign: number) {
  const [values, options] = split(args)
  const items = values.length === 1 ? [...iter(values[0])] : values
  if (!items.length) {
    if (Object.hasOwn(options, 'default')) return options.default
    throw new ValueError(`${sign > 0 ? 'max' : 'min'}() iterable argument is empty`)
  }
  const key = options.key ?? ((v: any) => v)
  let best = items[0],
    bestKey = key(best)
  for (const v of items.slice(1)) {
    const k = key(v)
    if (cmp(k, bestKey) * sign > 0) {
      best = v
      bestKey = k
    }
  }
  return best
}
export const max = (...args: any[]) => extreme(args, 1)
export const min = (...args: any[]) => extreme(args, -1)
/** `sum`: CPython's, which adds floats with Neumaier compensation. */
export function sum(x: any, start: any = 0): any {
  let result = start
  let i = 0
  const items = [...iter(x)]
  if (typeof result === 'number' && Number.isInteger(result)) {
    for (; i < items.length; i++) {
      const v = items[i]
      if (!(typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v)))) break
      result += number(v)
    }
    if (i < items.length) result = add(result, items[i++])
  }
  if (typeof result === 'number' && !Number.isInteger(result)) {
    let f = result,
      c = 0
    for (; i < items.length; i++) {
      const v = items[i]
      if (typeof v === 'number' && !Number.isInteger(v)) {
        const s = f + v
        if (Math.abs(f) >= Math.abs(v)) c += f - s + v
        else c += v - s + f
        f = s
      } else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v))) f += number(v)
      else break
    }
    if (i === items.length) return c && Number.isFinite(c) ? f + c : f
    result = c && Number.isFinite(c) ? f + c : f
  }
  for (; i < items.length; i++) result = add(result, items[i])
  return result
}
export function any(x: any): boolean {
  for (const v of iter(x)) if (t(v)) return true
  return false
}
export function all(x: any): boolean {
  for (const v of iter(x)) if (!t(v)) return false
  return true
}
export function abs(x: any): number {
  checkNumbers(x, 0, 'abs')
  return Math.abs(number(x))
}
/** `round(x)` (ties to even, an int) and `round(x, n)`. */
export function round(x: any, n?: any): number {
  if (n === undefined || n === null) {
    const f = Math.floor(x)
    const d = x - f
    return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f
  }
  if (Number.isInteger(x) && n >= 0) return x
  return pyRound(x, number(n))
}
export function isinstance(x: any, classes: any): boolean {
  const list_ = Array.isArray(classes) ? classes : [classes]
  return list_.some((c) => {
    if (c === str) return typeof x === 'string'
    if (c === int) return (typeof x === 'number' && Number.isInteger(x)) || typeof x === 'boolean'
    if (c === float) return typeof x === 'number'
    if (c === bool) return typeof x === 'boolean'
    if (c === list) return Array.isArray(x) && !(x instanceof PyTuple)
    if (c === tupleOf) return x instanceof PyTuple
    if (c === dict) return x instanceof PyDict
    if (c === set || c === frozenset) return x instanceof PySet
    return typeof c === 'function' && x instanceof c
  })
}
export function hasattr(x: any, name: string): boolean {
  return x != null && typeof x === 'object' && !(x instanceof PyDict) && name in x
}
export function getattr(x: any, name: string, ...fallback: any[]): any {
  if (hasattr(x, name)) return x[name]
  if (fallback.length) return fallback[0]
  throw new AttributeError(`'${typeName(x)}' object has no attribute '${name}'`)
}

// ---------------------------------------------------------------- methods

/** `x.name(...args)` on a value of a builtin type, else its own method. */
export function call(x: any, name: string, ...args: any[]): any {
  if (typeof x === 'string') return strMethod(x, name, args)
  if (Array.isArray(x)) return listMethod(x, name, args)
  if (x instanceof PyDict) return dictMethod(x, name, args)
  if (x instanceof PySet) return setMethod(x, name, args)
  if (x == null) throw new AttributeError(`'NoneType' object has no attribute '${name}'`)
  const f = x[name]
  if (typeof f !== 'function') throw new AttributeError(`'${typeName(x)}' object has no attribute '${name}'`)
  return f.apply(x, args)
}
function stripChars(s: string, chars: any, left: boolean, right: boolean): string {
  if (chars == null) {
    let a = 0,
      b = s.length
    if (left) while (a < b && isSpace(s[a]!)) a++
    if (right) while (b > a && isSpace(s[b - 1]!)) b--
    return s.slice(a, b)
  }
  const set_ = new Set(cpArray(chars))
  const items = cpArray(s)
  let a = 0,
    b = items.length
  if (left) while (a < b && set_.has(items[a]!)) a++
  if (right) while (b > a && set_.has(items[b - 1]!)) b--
  return items.slice(a, b).join('')
}
function prefixes(arg: any): string[] {
  return arg instanceof PyTuple ? [...arg] : [arg]
}
function strMethod(s: string, name: string, args: any[]): any {
  const [a, options] = split(args)
  switch (name) {
    case 'lower':
      return s.toLowerCase()
    case 'upper':
      return s.toUpperCase()
    case 'strip':
      return stripChars(s, a[0], true, true)
    case 'lstrip':
      return stripChars(s, a[0], true, false)
    case 'rstrip':
      return stripChars(s, a[0], false, true)
    case 'startswith': {
      const text = a[1] == null ? s : sl(s, a[1], a[2])
      return prefixes(a[0]).some((p) => text.startsWith(p))
    }
    case 'endswith': {
      const text = a[1] == null ? s : sl(s, a[1], a[2])
      return prefixes(a[0]).some((p) => text.endsWith(p))
    }
    case 'replace': {
      const count = a[2] == null ? -1 : number(a[2])
      if (count < 0) return s.split(a[0]).join(a[1])
      let out = '',
        rest = s,
        n = 0
      if (a[0] === '') {
        const chars = cpArray(s)
        for (let i = 0; i <= chars.length; i++) {
          if (n < count) {
            out += a[1]
            n++
          }
          if (i < chars.length) out += chars[i]
        }
        return out
      }
      while (n < count) {
        const i = rest.indexOf(a[0])
        if (i < 0) break
        out += rest.slice(0, i) + a[1]
        rest = rest.slice(i + a[0].length)
        n++
      }
      return out + rest
    }
    case 'split':
      return splitStr(s, a[0] ?? options.sep, a[1] ?? options.maxsplit ?? -1)
    case 'rsplit': {
      const sep = a[0] ?? options.sep,
        maxsplit = a[1] ?? options.maxsplit ?? -1
      if (maxsplit < 0) return splitStr(s, sep, -1)
      if (sep == null) {
        const parts = splitStr(s, null, -1)
        if (parts.length <= maxsplit + 1) return parts
        const head = stripChars(s, null, false, true)
        let rest = head,
          out: string[] = []
        for (let i = 0; i < maxsplit; i++) {
          const m = /[\t-\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+([^\t-\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*)$/.exec(rest)
          if (!m) break
          out.unshift(m[1]!)
          rest = rest.slice(0, m.index)
        }
        return [rest, ...out]
      }
      const parts = s.split(sep)
      if (parts.length <= maxsplit + 1) return parts
      return [parts.slice(0, parts.length - maxsplit).join(sep), ...parts.slice(parts.length - maxsplit)]
    }
    case 'splitlines':
      return pyLines(s)
    case 'join': {
      const items = [...iter(a[0])]
      for (const v of items)
        if (typeof v !== 'string') throw new TypeError_(`sequence item: expected str instance, ${typeName(v)} found`)
      return items.join(s)
    }
    case 'find':
    case 'index': {
      const start = a[1] == null ? 0 : utf16Index(s, index(cpLen(s), a[1]))
      const i = s.indexOf(a[0], Math.max(0, start))
      if (i < 0 && name === 'index') throw new ValueError('substring not found')
      return i < 0 ? -1 : cpIndex(s, i)
    }
    case 'rfind':
    case 'rindex': {
      const i = s.lastIndexOf(a[0])
      if (i < 0 && name === 'rindex') throw new ValueError('substring not found')
      return i < 0 ? -1 : cpIndex(s, i)
    }
    case 'count': {
      if (a[0] === '') return cpLen(s) + 1
      return s.split(a[0]).length - 1
    }
    case 'format':
      return formatMethod(s, a, options)
    case 'isdigit':
      return s.length > 0 && /^[\p{Nd}\u00b2\u00b3\u00b9\u2070-\u2079\u2080-\u2089\u2460-\u2468]+$/u.test(s)
    case 'isdecimal':
      return s.length > 0 && /^\p{Nd}+$/u.test(s)
    case 'isnumeric':
      return s.length > 0 && /^\p{N}+$/u.test(s)
    case 'isalpha':
      return s.length > 0 && /^\p{L}+$/u.test(s)
    case 'isalnum':
      return s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s)
    case 'isspace':
      return s.length > 0 && cpArray(s).every(isSpace)
    case 'isupper':
      return /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s)
    case 'islower':
      return /\p{Ll}/u.test(s) && !/\p{Lu}/u.test(s)
    case 'title':
      return s.replace(/[\p{L}\p{N}']+/gu, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    case 'capitalize':
      return s ? cpSlice(s, 0, 1).toUpperCase() + cpSlice(s, 1).toLowerCase() : s
    case 'removeprefix':
      return s.startsWith(a[0]) ? s.slice(a[0].length) : s
    case 'removesuffix':
      return a[0] && s.endsWith(a[0]) ? s.slice(0, -a[0].length) : s
    case 'zfill': {
      const width = number(a[0])
      const signed = s.startsWith('-') || s.startsWith('+')
      const body = signed ? s.slice(1) : s
      return (signed ? s[0] : '') + body.padStart(width - (signed ? 1 : 0), '0')
    }
    case 'ljust':
      return s + (a[1] ?? ' ').repeat(Math.max(0, number(a[0]) - cpLen(s)))
    case 'rjust':
      return (a[1] ?? ' ').repeat(Math.max(0, number(a[0]) - cpLen(s))) + s
    case 'center':
      return format(s, `${a[1] ?? ' '}^${a[0]}`)
    case 'partition': {
      const i = s.indexOf(a[0])
      return i < 0 ? tuple(s, '', '') : tuple(s.slice(0, i), a[0], s.slice(i + a[0].length))
    }
    case 'rpartition': {
      const i = s.lastIndexOf(a[0])
      return i < 0 ? tuple('', '', s) : tuple(s.slice(0, i), a[0], s.slice(i + a[0].length))
    }
    case 'casefold':
      return s.toLowerCase()
    case 'encode':
      return s
  }
  throw new AttributeError(`'str' object has no attribute '${name}'`)
}
function splitStr(s: string, sep: any, maxsplit: number): string[] {
  if (sep == null) {
    const out: string[] = []
    let rest = stripChars(s, null, true, false)
    while (rest) {
      if (maxsplit >= 0 && out.length === maxsplit) {
        out.push(rest)
        break
      }
      let i = 0
      while (i < rest.length && !isSpace(rest[i]!)) i++
      out.push(rest.slice(0, i))
      rest = stripChars(rest.slice(i), null, true, false)
    }
    return out
  }
  if (sep === '') throw new ValueError('empty separator')
  const parts = s.split(sep)
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)]
}
function formatMethod(s: string, args: any[], keywords: Record<string, any>): string {
  let auto = 0
  return s.replace(/\{\{|\}\}|\{([^{}!:]*)(?:!([rsa]))?(?::([^{}]*))?\}/g, (m, field, conversion, spec) => {
    if (m === '{{') return '{'
    if (m === '}}') return '}'
    let value: any
    const [head, ...path] = String(field).split('.')
    if (head === '') value = args[auto++]
    else if (/^\d+$/.test(head!)) value = args[Number(head)]
    else if (Object.hasOwn(keywords, head!)) value = keywords[head!]
    else throw new KeyError(head)
    for (const p of path) value = value[p]
    return fv(value, spec, conversion)
  })
}
function listMethod(x: any[], name: string, args: any[]): any {
  const [a, options] = split(args)
  const mutable = !(x instanceof PyTuple)
  switch (name) {
    case 'append':
      if (mutable) return void x.push(a[0])
      break
    case 'extend':
      if (mutable) return void x.push(...iter(a[0]))
      break
    case 'insert':
      if (mutable) {
        let i = number(a[0])
        if (i < 0) i = Math.max(0, i + x.length)
        return void x.splice(Math.min(i, x.length), 0, a[1])
      }
      break
    case 'pop': {
      if (!mutable) break
      if (!x.length) throw new IndexError('pop from empty list')
      const i = a.length ? index(x.length, a[0]) : x.length - 1
      if (i < 0 || i >= x.length) throw new IndexError('pop index out of range')
      return x.splice(i, 1)[0]
    }
    case 'remove': {
      if (!mutable) break
      const i = x.findIndex((v) => eq(v, a[0]))
      if (i < 0) throw new ValueError('list.remove(x): x not in list')
      return void x.splice(i, 1)
    }
    case 'index': {
      const i = x.findIndex((v) => eq(v, a[0]))
      if (i < 0) throw new ValueError(`${repr(a[0])} is not in list`)
      return i
    }
    case 'count':
      return x.filter((v) => eq(v, a[0])).length
    case 'sort':
      if (mutable) return void sortInPlace(x, options.key, options.reverse)
      break
    case 'reverse':
      if (mutable) return void x.reverse()
      break
    case 'copy':
      if (mutable) return [...x]
      break
    case 'clear':
      if (mutable) return void x.splice(0)
      break
  }
  throw new AttributeError(`'${typeName(x)}' object has no attribute '${name}'`)
}
function dictMethod(d: PyDict, name: string, args: any[]): any {
  const [a, options] = split(args)
  switch (name) {
    case 'get': {
      const e = d.lookup(a[0])
      return e ? e[1] : (a[1] ?? null)
    }
    case 'keys':
      return [...d.keys()]
    case 'values':
      return [...d.values()]
    case 'items':
      return [...d.entries()].map(([k, v]) => tuple(k, v))
    case 'update': {
      if (a.length) {
        const source = a[0]
        if (source instanceof PyDict) for (const [k, v] of source.entries()) d.set(k, v)
        else for (const item of iter(source)) {
          const [k, v] = unpack(item, 2)
          d.set(k, v)
        }
      }
      for (const [k, v] of Object.entries(options)) d.set(k, v)
      return null
    }
    case 'setdefault': {
      const e = d.lookup(a[0])
      if (e) return e[1]
      d.set(a[0], a[1] ?? null)
      return a[1] ?? null
    }
    case 'pop': {
      const e = d.lookup(a[0])
      if (e) {
        d.delete(a[0])
        return e[1]
      }
      if (a.length > 1) return a[1]
      throw new KeyError(a[0])
    }
    case 'copy':
      return new PyDict(d.entries())
    case 'clear':
      d.map.clear()
      return null
  }
  throw new AttributeError(`'dict' object has no attribute '${name}'`)
}
function setMethod(s: PySet, name: string, args: any[]): any {
  const [a] = split(args)
  switch (name) {
    case 'add':
      s.add(a[0])
      return null
    case 'update':
      for (const other of a) for (const v of iter(other)) s.add(v)
      return null
    case 'discard':
      s.delete(a[0])
      return null
    case 'remove':
      if (!s.delete(a[0])) throw new KeyError(a[0])
      return null
    case 'union':
      return new PySet([...s.values(), ...a.flatMap((o) => [...iter(o)])])
    case 'intersection': {
      const others = a.map((o) => set(o))
      return new PySet([...s.values()].filter((v) => others.every((o) => o.has(v))))
    }
    case 'difference': {
      const others = a.map((o) => set(o))
      return new PySet([...s.values()].filter((v) => others.every((o) => !o.has(v))))
    }
    case 'issubset': {
      const other = set(a[0])
      return [...s.values()].every((v) => other.has(v))
    }
    case 'issuperset':
      return [...iter(a[0])].every((v) => s.has(v))
    case 'isdisjoint':
      return [...iter(a[0])].every((v) => !s.has(v))
    case 'copy':
      return new PySet(s.values())
  }
  throw new AttributeError(`'set' object has no attribute '${name}'`)
}

// ---------------------------------------------------------------- re

/** Python's \w, \d and \s, and the characters the port's patterns need. */
const W = '\\p{L}\\p{N}_'
const D = '\\p{Nd}'
const S = '\\t-\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const AW = 'A-Za-z0-9_'
const AS = '\\t-\\r \\u001c-\\u001f'
const SYNTAX = new Set('^$\\.*+?()[]{}|/'.split(''))
export const I = 2,
  L = 4,
  M = 8,
  S_ = 16,
  U = 32,
  X = 64,
  A = 256
interface Translated {
  source: string
  flags: string
  groups: number
  names: Map<string, number>
}
/** A Python pattern as a JavaScript one (`u` mode), with Python's anchors,
 * `.`, character classes and `\b`. */
function translate(pattern: string, flags: number): Translated {
  let out = ''
  let i = 0
  let groups = 0
  const names = new Map<string, number>()
  const head = /^\(\?([aiLmsux]+)\)/.exec(pattern)
  if (head) {
    for (const f of head[1]!)
      flags |= { a: A, i: I, L: L, m: M, s: S_, u: U, x: X }[f as 'a']!
    i = head[0].length
  }
  const ascii = (flags & A) !== 0
  const w = ascii ? AW : W,
    d = ascii ? '0-9' : D,
    s = ascii ? AS : S
  const word = `[${w}]`
  const verbose = (flags & X) !== 0
  const dotall = (flags & S_) !== 0,
    multiline = (flags & M) !== 0
  const literal = (ch: string) => (SYNTAX.has(ch) ? '\\' + ch : ch === '-' ? '-' : ch)
  const escapeCode = (code: number) => '\\u{' + code.toString(16) + '}'
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (verbose && /\s/.test(ch)) {
      i++
      continue
    }
    if (verbose && ch === '#') {
      while (i < pattern.length && pattern[i] !== '\n') i++
      continue
    }
    if (ch === '\\') {
      const [text, used] = escape(pattern, i, false)
      out += text
      i += used
      continue
    }
    if (ch === '[') {
      let j = i + 1
      let cls = '['
      if (pattern[j] === '^') {
        cls += '^'
        j++
      }
      if (pattern[j] === ']') {
        cls += '\\]'
        j++
      }
      while (j < pattern.length && pattern[j] !== ']') {
        const c = pattern[j]!
        if (c === '\\') {
          const [text, used] = escape(pattern, j, true)
          cls += text
          j += used
        } else {
          cls += c === '[' || c === '/' ? '\\' + c : c
          j++
        }
      }
      if (j >= pattern.length) throw new ValueError(`unterminated character set at position ${i}`)
      out += cls + ']'
      i = j + 1
      continue
    }
    if (ch === '(') {
      if (pattern.startsWith('(?P<', i)) {
        const end = pattern.indexOf('>', i)
        const name = pattern.slice(i + 4, end)
        groups++
        names.set(name, groups)
        out += `(?<${name}>`
        i = end + 1
        continue
      }
      if (pattern.startsWith('(?P=', i)) {
        const end = pattern.indexOf(')', i)
        out += `\\k<${pattern.slice(i + 4, end)}>`
        i = end + 1
        continue
      }
      if (pattern.startsWith('(?#', i)) {
        i = pattern.indexOf(')', i) + 1
        continue
      }
      if (pattern[i + 1] !== '?' || pattern.startsWith('(?<', i) && !'=!'.includes(pattern[i + 3]!)) {
        groups++
        if (pattern.startsWith('(?<', i)) {
          const end = pattern.indexOf('>', i)
          names.set(pattern.slice(i + 3, end), groups)
        }
      }
      out += '('
      i++
      continue
    }
    if (ch === '.') {
      out += dotall ? '[\\s\\S]' : '[^\\n]'
      i++
      continue
    }
    if (ch === '^') {
      out += multiline ? '(?:(?<![\\s\\S])|(?<=\\n))' : '(?<![\\s\\S])'
      i++
      continue
    }
    if (ch === '$') {
      out += multiline ? '(?=\\n|(?![\\s\\S]))' : '(?=\\n?(?![\\s\\S]))'
      i++
      continue
    }
    if (ch === '{') {
      const q = /^\{(\d*)(,(\d*))?\}/.exec(pattern.slice(i))
      if (q && (q[1] || q[3] !== undefined)) {
        out += q[1] ? q[0] : `{0${q[0].slice(1)}`
        i += q[0].length
        continue
      }
      out += '\\{'
      i++
      continue
    }
    if (ch === '}') {
      out += '\\}'
      i++
      continue
    }
    out += ch
    i++
  }
  function escape(p: string, at: number, inClass: boolean): [string, number] {
    const c = p[at + 1]
    if (c === undefined) throw new ValueError('bad escape (end of pattern)')
    const neg = (body: string) => (inClass ? unsupported() : `[^${body}]`)
    const unsupported = (): never => {
      throw new ValueError(`unsupported escape \\${c} in a character class`)
    }
    switch (c) {
      case 'd':
        return [inClass ? d : `[${d}]`, 2]
      case 'D':
        return [neg(d), 2]
      case 'w':
        return [inClass ? w : word, 2]
      case 'W':
        return [neg(w), 2]
      case 's':
        return [inClass ? s : `[${s}]`, 2]
      case 'S':
        return [neg(s), 2]
      case 'b':
        if (inClass) return ['\\x08', 2]
        return [`(?:(?<=${word})(?!${word})|(?<!${word})(?=${word}))`, 2]
      case 'B':
        return [`(?:(?<=${word})(?=${word})|(?<!${word})(?!${word}))`, 2]
      case 'A':
        return ['(?<![\\s\\S])', 2]
      case 'Z':
        return ['(?![\\s\\S])', 2]
      case 'n':
        return ['\\n', 2]
      case 't':
        return ['\\t', 2]
      case 'r':
        return ['\\r', 2]
      case 'f':
        return ['\\f', 2]
      case 'v':
        return ['\\v', 2]
      case 'a':
        return ['\\x07', 2]
      case 'x':
        return [escapeCode(parseInt(p.slice(at + 2, at + 4), 16)), 4]
      case 'u':
        return [escapeCode(parseInt(p.slice(at + 2, at + 6), 16)), 6]
      case 'U':
        return [escapeCode(parseInt(p.slice(at + 2, at + 10), 16)), 10]
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-7]{3}/.exec(p.slice(at + 1))
      if (m || c === '0') {
        const digits = m ? m[0] : (/^0[0-7]{0,2}/.exec(p.slice(at + 1))![0])
        return [escapeCode(parseInt(digits, 8)), 1 + digits.length]
      }
      const n = /^\d{1,2}/.exec(p.slice(at + 1))![0]
      return [inClass ? unsupported() : `\\${n}`, 1 + n.length]
    }
    if (/[A-Za-z]/.test(c)) throw new ValueError(`bad escape \\${c}`)
    if (inClass) return [c === '-' || c === ']' || c === '\\' || c === '^' || SYNTAX.has(c) ? '\\' + c : c, 2]
    return [literal(c), 2]
  }
  return { source: out, flags: 'u' + ((flags & I) !== 0 ? 'i' : ''), groups, names }
}
const compiled = new Map<string, { t: Translated; search: RegExp; sticky: RegExp; global: RegExp }>()
function compile_(pattern: string, flags: number) {
  const key = flags + '\0' + pattern
  let c = compiled.get(key)
  if (!c) {
    const t = translate(pattern, flags)
    c = {
      t,
      search: new RegExp(t.source, t.flags),
      sticky: new RegExp(t.source, t.flags + 'y'),
      global: new RegExp(t.source, t.flags + 'g'),
    }
    compiled.set(key, c)
  }
  return c
}
/** A `re.Match`. Positions are code points, as Python counts them. */
export class Match {
  readonly string: string
  private readonly m: RegExpExecArray
  private readonly t: Translated
  readonly re: Pattern
  constructor(string: string, m: RegExpExecArray, t: Translated, re: Pattern) {
    this.string = string
    this.m = m
    this.t = t
    this.re = re
  }
  private number(g: any): number {
    if (typeof g === 'string') {
      const n = this.t.names.get(g)
      if (n === undefined) throw new IndexError('no such group')
      return n
    }
    const n = g ?? 0
    if (n < 0 || n > this.t.groups) throw new IndexError('no such group')
    return n
  }
  group(...gs: any[]): any {
    if (gs.length > 1) return tuple(...gs.map((g) => this.group(g)))
    return this.m[this.number(gs[0])] ?? null
  }
  __getitem__(g: any) {
    return this.group(g)
  }
  groups(fallback: any = null) {
    return tuple(...Array.from({ length: this.t.groups }, (_, i) => this.m[i + 1] ?? fallback))
  }
  groupdict(fallback: any = null) {
    return new PyDict([...this.t.names].map(([name, n]) => [name, this.m[n] ?? fallback]))
  }
  private bounds(g: any): [number, number] {
    const n = this.number(g)
    if (n === 0) {
      const a = this.m.index
      return [cpIndex(this.string, a), cpIndex(this.string, a + this.m[0].length)]
    }
    const indices = (this.m as any).indices?.[n] as [number, number] | undefined
    if (!indices) return [-1, -1]
    return [cpIndex(this.string, indices[0]), cpIndex(this.string, indices[1])]
  }
  start(g: any = 0) {
    return this.bounds(g)[0]
  }
  end(g: any = 0) {
    return this.bounds(g)[1]
  }
  span(g: any = 0) {
    return tuple(...this.bounds(g))
  }
  get lastindex() {
    for (let i = this.t.groups; i > 0; i--) if (this.m[i] !== undefined) return i
    return null
  }
  __bool__() {
    return true
  }
}
function withIndices(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags + 'd')
}
/** A `re.Pattern`. */
export class Pattern {
  readonly pattern: string
  readonly flags: number
  constructor(pattern: string, flags: number) {
    this.pattern = pattern
    this.flags = flags
  }
  private get c() {
    return compile_(this.pattern, this.flags)
  }
  private exec(re: RegExp, string: string, at: number): Match | null {
    const r = this.c.t.groups ? withIndices(re) : re
    r.lastIndex = at
    const m = r.exec(string)
    return m ? new Match(string, m, this.c.t, this) : null
  }
  search(string: string, pos: any = 0) {
    const r = new RegExp(this.c.search.source, this.c.search.flags + 'g')
    return this.exec(r, string, utf16Index(string, pos))
  }
  match(string: string, pos: any = 0) {
    return this.exec(this.c.sticky, string, utf16Index(string, pos))
  }
  fullmatch(string: string, pos: any = 0) {
    const full = new RegExp(`(?:${this.c.t.source})(?![\\s\\S])`, this.c.t.flags + 'y')
    return this.exec(full, string, utf16Index(string, pos))
  }
  *finditer(string: string) {
    const r = new RegExp(this.c.global.source, this.c.global.flags + (this.c.t.groups ? 'd' : ''))
    let m: RegExpExecArray | null
    r.lastIndex = 0
    while ((m = r.exec(string))) {
      yield new Match(string, m, this.c.t, this)
      if (m[0] === '') r.lastIndex += string.codePointAt(r.lastIndex)! > 0xffff ? 2 : 1
    }
  }
  findall(string: string) {
    return [...this.finditer(string)].map((m) =>
      this.c.t.groups === 0 ? m.group(0) : this.c.t.groups === 1 ? (m.group(1) ?? '') : m.groups('')
    )
  }
  sub(repl: any, string: string, count: any = 0) {
    let n = 0
    const limit = number(count)
    let out = '',
      last = 0
    for (const m of this.finditer(string)) {
      if (limit > 0 && n >= limit) break
      const start = utf16Index(string, m.start()),
        end = utf16Index(string, m.end())
      out += string.slice(last, start) + (typeof repl === 'string' ? expand(repl, m) : str(repl(m)))
      last = end
      n++
    }
    return out + string.slice(last)
  }
  split(string: string, maxsplit: any = 0) {
    const out: any[] = []
    let last = 0,
      n = 0
    for (const m of this.finditer(string)) {
      if (number(maxsplit) > 0 && n >= number(maxsplit)) break
      const start = utf16Index(string, m.start()),
        end = utf16Index(string, m.end())
      out.push(string.slice(last, start), ...[...m.groups()])
      last = end
      n++
    }
    out.push(string.slice(last))
    return out
  }
}
/** A `re.sub` template: `\1`, `\g<name>` and Python's string escapes. */
function expand(template: string, m: Match): string {
  return template.replace(/\\(g<([^>]+)>|\d{1,2}|[\\nrtfvab'"])/g, (all, what: string, name?: string) => {
    if (name !== undefined) return m.group(/^\d+$/.test(name) ? Number(name) : name) ?? ''
    if (/^\d/.test(what)) return m.group(Number(what)) ?? ''
    return { '\\': '\\', n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', a: '\x07', b: '\b', "'": "'", '"': '"' }[what] ?? all
  })
}
function flagsOf(args: any[], at: number): [any[], number] {
  const [a, options] = split(args)
  return [a, number(a[at] ?? options.flags ?? 0)]
}
export const re = {
  I,
  IGNORECASE: I,
  M,
  MULTILINE: M,
  S: S_,
  DOTALL: S_,
  X,
  VERBOSE: X,
  U,
  UNICODE: U,
  A,
  ASCII: A,
  compile: (...args: any[]) => {
    const [a, flags] = flagsOf(args, 1)
    return a[0] instanceof Pattern ? a[0] : new Pattern(a[0], flags)
  },
  search: (...args: any[]) => {
    const [a, flags] = flagsOf(args, 2)
    return pattern(a[0], flags).search(a[1])
  },
  match: (...args: any[]) => {
    const [a, flags] = flagsOf(args, 2)
    return pattern(a[0], flags).match(a[1])
  },
  fullmatch: (...args: any[]) => {
    const [a, flags] = flagsOf(args, 2)
    return pattern(a[0], flags).fullmatch(a[1])
  },
  findall: (...args: any[]) => {
    const [a, flags] = flagsOf(args, 2)
    return pattern(a[0], flags).findall(a[1])
  },
  finditer: (...args: any[]) => {
    const [a, flags] = flagsOf(args, 2)
    return pattern(a[0], flags).finditer(a[1])
  },
  sub: (...args: any[]) => {
    const [a, options] = split(args)
    return pattern(a[0], number(a[4] ?? options.flags ?? 0)).sub(a[1], a[2], a[3] ?? options.count ?? 0)
  },
  split: (...args: any[]) => {
    const [a, options] = split(args)
    return pattern(a[0], number(a[3] ?? options.flags ?? 0)).split(a[1], a[2] ?? options.maxsplit ?? 0)
  },
  escape: (s: string) => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, (c) => '\\' + c),
}
function pattern(p: any, flags: number): Pattern {
  if (p instanceof Pattern) return p
  if (typeof p !== 'string') throw new TypeError_('first argument must be string or compiled pattern')
  return new Pattern(p, flags)
}

// ---------------------------------------------------------------- json

/** `json.loads`, CPython's parser: its errors, NaN and Infinity, objects
 * as dicts. */
function loads(s: any): any {
  if (typeof s !== 'string') throw new TypeError_(`the JSON object must be str, bytes or bytearray, not ${typeName(s)}`)
  const text = s
  let i = 0
  const pos = () => cpIndex(text, i)
  const fail = (msg: string, at = i) => {
    throw new JSONDecodeError(msg, text, cpIndex(text, at))
  }
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++
  }
  const value = (): any => {
    const c = text[i]
    if (c === '"') return string()
    if (c === '{') return object()
    if (c === '[') return array()
    if (c === 'n' && text.startsWith('null', i)) return ((i += 4), null)
    if (c === 't' && text.startsWith('true', i)) return ((i += 4), true)
    if (c === 'f' && text.startsWith('false', i)) return ((i += 5), false)
    if (c === 'N' && text.startsWith('NaN', i)) return ((i += 3), NaN)
    if (c === 'I' && text.startsWith('Infinity', i)) return ((i += 8), Infinity)
    if (c === '-' && text.startsWith('-Infinity', i)) return ((i += 9), -Infinity)
    const m = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/.exec(text.slice(i))
    if (m) {
      i += m[0].length
      return Number(m[0])
    }
    return fail('Expecting value')
  }
  const string = (): string => {
    const start = i
    i++
    let out = ''
    for (;;) {
      if (i >= text.length) fail('Unterminated string starting at', start)
      const c = text[i]!
      if (c === '"') {
        i++
        return out
      }
      if (c === '\\') {
        const e = text[i + 1]
        if (e === undefined) fail('Unterminated string starting at', start)
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (e! in simple) {
          out += simple[e!]
          i += 2
        } else if (e === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\uXXXX escape', i + 1)
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else fail('Invalid \\escape', i)
        continue
      }
      if (c.charCodeAt(0) < 0x20) fail('Invalid control character at', i)
      out += c
      i++
    }
  }
  const object = (): PyDict => {
    const d = new PyDict()
    i++
    ws()
    if (text[i] === '}') return ((i += 1), d)
    for (;;) {
      if (text[i] !== '"') fail('Expecting property name enclosed in double quotes')
      const k = string()
      ws()
      if (text[i] !== ':') fail("Expecting ':' delimiter")
      i++
      ws()
      d.set(k, value())
      ws()
      if (text[i] === '}') return ((i += 1), d)
      if (text[i] !== ',') fail("Expecting ',' delimiter")
      i++
      ws()
      if (text[i] === '}') fail('Illegal trailing comma before end of object')
    }
  }
  const array = (): any[] => {
    const out: any[] = []
    i++
    ws()
    if (text[i] === ']') return ((i += 1), out)
    for (;;) {
      out.push(value())
      ws()
      if (text[i] === ']') return ((i += 1), out)
      if (text[i] !== ',') fail("Expecting ',' delimiter")
      i++
      ws()
      if (text[i] === ']') fail('Illegal trailing comma before end of array')
    }
  }
  ws()
  const result = value()
  ws()
  if (i !== text.length) fail('Extra data')
  void pos
  return result
}
/** `json.dumps` with CPython's separators and escapes. */
function dumps(...args: any[]): string {
  const [[value], options] = split(args)
  const ascii = options.ensure_ascii ?? true
  const indent = options.indent ?? null
  const [itemSep, keySep] = options.separators ? [...options.separators] : [indent != null ? ',' : ', ', ': ']
  const sortKeys = t(options.sort_keys)
  const quote = (s: string) => {
    let out = '"'
    for (const ch of s) {
      const c = ch.codePointAt(0)!
      if (ch === '"') out += '\\"'
      else if (ch === '\\') out += '\\\\'
      else if (ch === '\n') out += '\\n'
      else if (ch === '\r') out += '\\r'
      else if (ch === '\t') out += '\\t'
      else if (ch === '\b') out += '\\b'
      else if (ch === '\f') out += '\\f'
      else if (c < 0x20 || (ascii && c > 0x7e)) {
        if (c > 0xffff) {
          const v = c - 0x10000
          out += '\\u' + (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + '\\u' + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
        } else out += '\\u' + c.toString(16).padStart(4, '0')
      } else out += ch
    }
    return out + '"'
  }
  const pad = (level: number) =>
    indent == null ? '' : '\n' + (typeof indent === 'string' ? indent : ' '.repeat(indent)).repeat(level)
  const enc = (v: any, level: number): string => {
    if (v === null || v === undefined) return 'null'
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'NaN'
      if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
      return Number.isInteger(v) ? reprInt(v) : reprFloat(v)
    }
    if (typeof v === 'string') return quote(v)
    if (Array.isArray(v)) {
      if (!v.length) return '[]'
      return '[' + pad(level + 1) + v.map((x) => enc(x, level + 1)).join(itemSep + pad(level + 1)) + pad(level) + ']'
    }
    if (v instanceof PyDict) {
      if (!v.size) return '{}'
      let entries = [...v.entries()]
      if (sortKeys) entries = sorted(entries.map(([k, x]) => tuple(k, x)), kw({ key: (e: any) => e[0] }))
      const parts = entries.map(([k, x]) => {
        const key = typeof k === 'string' ? k : typeof k === 'number' ? (Number.isInteger(k) ? reprInt(k) : reprFloat(k)) : k === true ? 'true' : k === false ? 'false' : k == null ? 'null' : null
        if (key === null) throw new TypeError_(`keys must be str, int, float, bool or None, not ${typeName(k)}`)
        return quote(key) + keySep + enc(x, level + 1)
      })
      return '{' + pad(level + 1) + parts.join(itemSep + pad(level + 1)) + pad(level) + '}'
    }
    if (typeof v.model_dump === 'function') throw new TypeError_(`Object of type ${typeName(v)} is not JSON serializable`)
    throw new TypeError_(`Object of type ${typeName(v)} is not JSON serializable`)
  }
  return enc(value, 0)
}
export const json = { loads, dumps, JSONDecodeError }

/** A JSON value from outside the port, as Python's `json.load` gives it. */
export function fromJSON(value: any): any {
  if (Array.isArray(value)) return value instanceof PyTuple ? value : value.map(fromJSON)
  const proto = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined
  if (proto === Object.prototype || proto === null) return new PyDict(Object.entries(value).map(([k, v]) => [k, fromJSON(v)]))
  return value
}
/** A port value as JSON for the verifier's output. */
export function toJSON(value: any): any {
  if (value instanceof PyDict) return Object.fromEntries([...value.entries()].map(([k, v]) => [str(k), toJSON(v)]))
  if (value instanceof PySet) return [...value.values()].map(toJSON)
  if (Array.isArray(value)) return value.map(toJSON)
  if (value && typeof value === 'object' && typeof value.model_dump === 'function') return toJSON(value.model_dump())
  return value
}

// ---------------------------------------------------------------- random, time

/** CPython's Mersenne Twister, seeded as `random.seed(int)` seeds it. */
class MersenneTwister {
  private mt = new Uint32Array(624)
  private index = 625
  seed(n: number) {
    // init_by_array with the seed's 32-bit words (one word for small ints).
    let words: number[] = []
    let v = BigInt(Math.abs(Math.trunc(n)))
    do {
      words.push(Number(v & 0xffffffffn))
      v >>= 32n
    } while (v > 0n)
    this.initGenrand(19650218)
    let i = 1,
      j = 0
    const mt = this.mt
    for (let k = Math.max(624, words.length); k; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30)
      mt[i] = (mt[i]! ^ Math.imul(prev, 1664525)) + words[j]! + j
      i++
      j++
      if (i >= 624) {
        mt[0] = mt[623]!
        i = 1
      }
      if (j >= words.length) j = 0
    }
    for (let k = 623; k; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30)
      mt[i] = (mt[i]! ^ Math.imul(prev, 1566083941)) - i
      i++
      if (i >= 624) {
        mt[0] = mt[623]!
        i = 1
      }
    }
    mt[0] = 0x80000000
    this.index = 624
  }
  private initGenrand(s: number) {
    const mt = this.mt
    mt[0] = s >>> 0
    for (let i = 1; i < 624; i++) mt[i] = Math.imul(1812433253, mt[i - 1]! ^ (mt[i - 1]! >>> 30)) + i
  }
  private next32(): number {
    const mt = this.mt
    if (this.index >= 624) {
      if (this.index === 625) this.initGenrand(5489)
      for (let k = 0; k < 624; k++) {
        const y = (mt[k]! & 0x80000000) | (mt[(k + 1) % 624]! & 0x7fffffff)
        mt[k] = mt[(k + 397) % 624]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
      }
      this.index = 0
    }
    let y = mt[this.index++]!
    y ^= y >>> 11
    y ^= (y << 7) & 0x9d2c5680
    y ^= (y << 15) & 0xefc60000
    y ^= y >>> 18
    return y >>> 0
  }
  random(): number {
    const a = this.next32() >>> 5,
      b = this.next32() >>> 6
    return (a * 67108864 + b) / 9007199254740992
  }
}
const twister = new MersenneTwister()
export const random = {
  seed: (n: number) => twister.seed(n),
  random: () => twister.random(),
  uniform: (a: number, b: number) => a + (b - a) * twister.random(),
}
/** What a `time.sleep` asks for; the judge's transport waits it out. */
export const clock = { sleep: (_seconds: number) => {} }
export const time = { sleep: (seconds: number) => clock.sleep(seconds) }
/** Upstream imports httpx for its Gemini-native judge route, which the
 * port's judge never takes. */
export const httpx = {
  post: (..._args: any[]) => {
    throw new RuntimeError('the Gemini-native judge route is not ported')
  },
}
/** Upstream's loggers write to stderr, which no grade reads. */
export const logging = {
  getLogger: (_name?: string) => ({ debug() {}, info() {}, warning() {}, error() {}, exception() {} }),
}
export const math = {
  comb(n: number, k: number) {
    if (k < 0 || k > n) return 0
    let r = 1
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
    return Math.round(r)
  },
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  log: Math.log,
  isfinite: Number.isFinite,
  inf: Infinity,
}

// ---------------------------------------------------------------- datetime

/** The run's clock, which `datetime.now()` reads. */
export const now = { iso: '2026-04-03T09:00:00+00:00' }
export class timedelta {
  readonly ms: number
  constructor(ms: number) {
    this.ms = ms
  }
  total_seconds() {
    return this.ms / 1000
  }
  get days() {
    return Math.floor(this.ms / 86400000)
  }
  get seconds() {
    return Math.floor((this.ms - this.days * 86400000) / 1000)
  }
}
/** A `datetime`: wall-clock fields and an optional UTC offset (minutes). */
export class datetime {
  readonly ms: number
  readonly offset: number | null
  constructor(ms: number, offset: number | null) {
    this.ms = ms
    this.offset = offset
  }
  static fromisoformat(s: any): datetime {
    const m =
      /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d{1,6}))?)?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?$/.exec(
        String(s)
      )
    if (!m) throw new ValueError(`Invalid isoformat string: ${reprStr(String(s))}`)
    const [, y, mo, d, h = '0', mi = '0', se = '0', frac = '0', tz] = m
    const ms = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +se, Math.floor(+frac.padEnd(6, '0') / 1000))
    let offset: number | null = null
    if (tz) {
      if (tz === 'Z') offset = 0
      else {
        const sign = tz[0] === '-' ? -1 : 1
        const parts = tz.slice(1).replace(/:/g, '')
        offset = sign * (+parts.slice(0, 2) * 60 + +(parts.slice(2, 4) || 0))
      }
    }
    return new datetime(ms, offset)
  }
  static now(tz?: any): datetime {
    const d = datetime.fromisoformat(now.iso)
    if (tz === undefined || tz === null) return new datetime(d.utc(), null)
    return new datetime(d.utc(), 0)
  }
  /** `dt.replace(field=...)`: `tzinfo=None` keeps the wall-clock time. */
  replace(...args: any[]) {
    const [, values] = split(args)
    const d = new Date(this.ms)
    const field = (name: string, current: number) => (Object.hasOwn(values, name) ? number(values[name]) : current)
    const ms = Date.UTC(
      field('year', d.getUTCFullYear()),
      field('month', d.getUTCMonth() + 1) - 1,
      field('day', d.getUTCDate()),
      field('hour', d.getUTCHours()),
      field('minute', d.getUTCMinutes()),
      field('second', d.getUTCSeconds()),
      Math.floor(field('microsecond', d.getUTCMilliseconds() * 1000) / 1000)
    )
    let offset = this.offset
    if (Object.hasOwn(values, 'tzinfo')) offset = values.tzinfo == null ? null : (values.tzinfo.utcoffset ?? 0)
    return new datetime(ms, offset)
  }
  /** Milliseconds since the epoch in UTC (a naive time as if UTC). */
  utc() {
    return this.ms - (this.offset ?? 0) * 60000
  }
  private check(other: datetime) {
    if ((this.offset === null) !== (other.offset === null))
      throw new TypeError_("can't compare offset-naive and offset-aware datetimes")
  }
  __sub__(other: any) {
    if (other instanceof timedelta) return new datetime(this.ms - other.ms, this.offset)
    this.check(other)
    return new timedelta(this.utc() - other.utc())
  }
  __add__(other: any) {
    if (other instanceof timedelta) return new datetime(this.ms + other.ms, this.offset)
    throw new TypeError_('unsupported operand type(s) for +')
  }
  __eq__(other: any) {
    return other instanceof datetime && (this.offset === null) === (other.offset === null) && this.utc() === other.utc()
  }
  __lt__(other: any) {
    this.check(other)
    return this.utc() < other.utc()
  }
  get year() {
    return new Date(this.ms).getUTCFullYear()
  }
  get month() {
    return new Date(this.ms).getUTCMonth() + 1
  }
  get day() {
    return new Date(this.ms).getUTCDate()
  }
  get hour() {
    return new Date(this.ms).getUTCHours()
  }
  get minute() {
    return new Date(this.ms).getUTCMinutes()
  }
  get second() {
    return new Date(this.ms).getUTCSeconds()
  }
  date() {
    return new date(this.year, this.month, this.day)
  }
  weekday() {
    return (new Date(this.ms).getUTCDay() + 6) % 7
  }
  isoformat() {
    const d = new Date(this.ms)
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    let out = `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
    if (d.getUTCMilliseconds()) out += '.' + p(d.getUTCMilliseconds() * 1000, 6)
    if (this.offset !== null) {
      const o = Math.abs(this.offset)
      out += (this.offset < 0 ? '-' : '+') + p(Math.floor(o / 60)) + ':' + p(o % 60)
    }
    return out
  }
  strftime(f: string) {
    const d = new Date(this.ms)
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return f.replace(/%([YmdHMS%])/g, (_, c) =>
      c === 'Y' ? p(d.getUTCFullYear(), 4) : c === 'm' ? p(d.getUTCMonth() + 1) : c === 'd' ? p(d.getUTCDate()) : c === 'H' ? p(d.getUTCHours()) : c === 'M' ? p(d.getUTCMinutes()) : c === 'S' ? p(d.getUTCSeconds()) : '%'
    )
  }
  __str__() {
    return this.isoformat().replace('T', ' ')
  }
}
export class date {
  readonly year: number
  readonly month: number
  readonly day: number
  constructor(year: number, month: number, day: number) {
    this.year = year
    this.month = month
    this.day = day
  }
  isoformat() {
    return `${String(this.year).padStart(4, '0')}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`
  }
  __eq__(other: any) {
    return other instanceof date && this.isoformat() === other.isoformat()
  }
  __lt__(other: any) {
    return this.isoformat() < other.isoformat()
  }
  __str__() {
    return this.isoformat()
  }
}
export const timezone = { utc: { utcoffset: 0 } }
export const datetimeModule = { datetime, date, timedelta, timezone }
