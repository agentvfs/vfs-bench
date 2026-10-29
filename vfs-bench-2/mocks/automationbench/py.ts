/**
 * Python's values and builtins as AutomationBench's handlers use them.
 *
 * Upstream's world is Pydantic models, and every api_fetch reply is
 * `json.dumps(...)` of dicts built from them. Here the world is the JSON of
 * `WorldState.model_dump(mode="json")`, and the replies are built from it,
 * so they must print as Python prints them:
 * - a float keeps its `.0`: a whole float is a `PyFloat`, read from JSON
 *   text with a `.` or an exponent, or made with `pf()` where upstream makes
 *   a float; any other number prints as an int if whole, else as `repr`.
 * - `dumps` is `json.dumps` with its defaults (`ensure_ascii`, `", "` and
 *   `": "`), and its `indent`, `sort_keys` and `default`.
 * - `str()` and `repr()` are Python's for these values.
 * - An exception upstream lets out of a tool is the tool's text (`f"{e}"`,
 *   verifiers' error formatter): a `PyError` carries its type and message.
 */

/** A Python float whose value is a whole number. */
export class PyFloat {
  readonly value: number
  constructor(value: number) {
    this.value = value
  }
  valueOf(): number {
    return this.value
  }
  toJSON(): number {
    return this.value
  }
}

/** A value whose JSON is Python's `default=` hook's business: datetimes, Decimals. */
export interface PyObject {
  /** Python's type name, for `TypeError: Object of type X is not JSON serializable`. */
  readonly pyType: string
  /** `str(self)`. */
  pyStr(): string
  /** `repr(self)`. */
  pyRepr(): string
}

export function isPyObject(value: unknown): value is PyObject {
  return typeof value === 'object' && value !== null && typeof (value as PyObject).pyStr === 'function'
}

export type Py = string | number | boolean | null | PyFloat | PyObject | Py[] | { [key: string]: Py }
export type PyDict = { [key: string]: Py }

/** An exception raised the way upstream's code raises it. */
export class PyError extends Error {
  readonly type: string
  constructor(type: string, message: string) {
    super(message)
    this.type = type
  }
}

export const valueError = (message: string): PyError => new PyError('ValueError', message)
export const typeError = (message: string): PyError => new PyError('TypeError', message)
export const keyError = (key: unknown): PyError => new PyError('KeyError', repr(key))

/** A computed float: a `PyFloat` where it is whole, so it prints as Python's. */
export function pf(value: number): number | PyFloat {
  return Number.isInteger(value) ? new PyFloat(value) : value
}

/** A number of either kind, as a JavaScript number. */
export function num(value: unknown): number {
  return value instanceof PyFloat ? value.value : (value as number)
}

/** Whether a value is a Python int or float (not a bool). */
export function isNumber(value: unknown): value is number | PyFloat {
  return typeof value === 'number' || value instanceof PyFloat
}

/** Whether a value is a Python float. */
export function isFloat(value: unknown): boolean {
  return value instanceof PyFloat || (typeof value === 'number' && !Number.isInteger(value))
}

/** Whether a value is a Python int (not a bool). */
export function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

export function isDict(value: unknown): value is PyDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof PyFloat) && !isPyObject(value)
}

/** `json.loads`, keeping whole floats as `PyFloat`. */
export function loads(text: string): Py {
  return JSON.parse(text, function (this: unknown, _key: string, value: unknown, context?: { source?: string }) {
    if (typeof value === 'number' && Number.isInteger(value) && context?.source !== undefined && /[.eE]/.test(context.source)) {
      return new PyFloat(value)
    }
    return value
  }) as Py
}

/** Python's `repr(float)`: the shortest text that reads back, as JavaScript's, in Python's spelling. */
export function floatRepr(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (value === Infinity) return 'inf'
  if (value === -Infinity) return '-inf'
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return `${value.toFixed(0)}.0`
  let text = String(value)
  // JavaScript writes 1e+21 and 1e-7; Python 1e+21 and 1e-07, and switches to
  // exponents at 1e16 where JavaScript waits for 1e21.
  if (!/e/.test(text) && Math.abs(value) >= 1e16) text = value.toExponential()
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(text)
  if (m !== null) {
    const mantissa = m[1]!
    const exp = m[3]!.length < 2 ? `0${m[3]}` : m[3]
    return `${mantissa}e${m[2]}${exp}`
  }
  return text
}

/** JSON's spelling of a float, as Python's encoder writes it. */
function jsonFloat(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return floatRepr(value)
}

/** A string as `json.dumps` quotes it. */
export function quote(text: string, ensureAscii = true): string {
  let out = '"'
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\b') out += '\\b'
    else if (ch === '\f') out += '\\f'
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`
    else if (ensureAscii && code > 0x7e) {
      if (code > 0xffff) {
        const v = code - 0x10000
        out += `\\u${(0xd800 + (v >> 10)).toString(16).padStart(4, '0')}\\u${(0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')}`
      } else out += `\\u${code.toString(16).padStart(4, '0')}`
    } else out += ch
  }
  return `${out}"`
}

export interface DumpOptions {
  indent?: number
  sortKeys?: boolean
  ensureAscii?: boolean
  /** `default=`: what a value JSON cannot hold becomes; without it, TypeError. */
  default?: (value: PyObject) => Py
  separators?: [string, string]
}

/** `json.dumps(value, ...)`. */
export function dumps(value: unknown, options: DumpOptions = {}): string {
  const { indent, sortKeys = false, ensureAscii = true } = options
  const [itemSep, keySep] = options.separators ?? (indent === undefined ? [', ', ': '] : [',', ': '])
  const key = (k: string): string => quote(k, ensureAscii)
  const go = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return 'null'
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (v instanceof PyFloat) return jsonFloat(v.value)
    if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : jsonFloat(v)
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'string') return quote(v, ensureAscii)
    if (isPyObject(v)) {
      if (options.default === undefined) throw typeError(`Object of type ${v.pyType} is not JSON serializable`)
      return go(options.default(v), depth)
    }
    const pad = indent === undefined ? '' : `\n${' '.repeat(indent * (depth + 1))}`
    const end = indent === undefined ? '' : `\n${' '.repeat(indent * depth)}`
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      return `[${pad}${v.map((x) => go(x, depth + 1)).join(`${itemSep}${pad}`)}${end}]`
    }
    if (typeof v === 'object') {
      let entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
      if (sortKeys) entries = entries.sort(([a], [b]) => cmpStr(a, b))
      if (entries.length === 0) return '{}'
      return `{${pad}${entries.map(([k, x]) => `${key(k)}${keySep}${go(x, depth + 1)}`).join(`${itemSep}${pad}`)}${end}}`
    }
    throw typeError(`Object of type ${typeof v} is not JSON serializable`)
  }
  return go(value, 0)
}

/** Python's string order: by code point, not UTF-16 unit. */
export function cmpStr(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const c = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (c !== 0) return c < 0 ? -1 : 1
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1
}

/** A deep copy of JSON-shaped values, `PyFloat`s and Python objects kept. */
export function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => copy(v)) as T
  if (isDict(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T
  return value
}

/** Python's `repr(str)`. */
export function strRepr(text: string): string {
  const quoteChar = text.includes("'") && !text.includes('"') ? '"' : "'"
  let out = quoteChar
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === quoteChar || ch === '\\') out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else if (code >= 0x80 && code < 0xa0) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return out + quoteChar
}

/** Python's `repr(value)`. */
export function repr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (value instanceof PyFloat) return floatRepr(value.value)
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : floatRepr(value)
  if (typeof value === 'string') return strRepr(value)
  if (isPyObject(value)) return value.pyRepr()
  if (Array.isArray(value)) return `[${value.map(repr).join(', ')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${strRepr(k)}: ${repr(v)}`)
      .join(', ')}}`
  }
  return String(value)
}

/** Python's `str(value)`. */
export function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (isPyObject(value)) return value.pyStr()
  return repr(value)
}

/** Python's truthiness. */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false
  if (typeof value === 'number') return value !== 0
  if (value instanceof PyFloat) return value.value !== 0
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0
  if (isPyObject(value)) return true
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/** Python's `x or y`. */
export function or<A, B>(a: A, b: B): A | B {
  return truthy(a) ? a : b
}

/** `d.get(key, fallback)`: the value where the key is present, even `None`. */
export function get<T = Py>(d: unknown, key: string, fallback: T = null as T): Py | T {
  return isDict(d) && Object.hasOwn(d, key) ? d[key]! : fallback
}

/** Python's `a == b` for JSON-shaped values: 1 == 1.0, and True == 1. */
export function eq(a: unknown, b: unknown): boolean {
  const n = (v: unknown): unknown => (v instanceof PyFloat ? v.value : v === true ? 1 : v === false ? 0 : v)
  const x = n(a)
  const y = n(b)
  if (typeof x === 'number' && typeof y === 'number') return x === y
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => eq(v, y[i]))
  if (isDict(x) && isDict(y)) {
    const kx = Object.keys(x)
    return kx.length === Object.keys(y).length && kx.every((k) => Object.hasOwn(y, k) && eq(x[k], y[k]))
  }
  if (isPyObject(x) && isPyObject(y)) return x.pyType === y.pyType && x.pyRepr() === y.pyRepr()
  return x === y
}

/** `value in seq` for a list or string. */
export function contains(seq: unknown, value: unknown): boolean {
  if (typeof seq === 'string') return typeof value === 'string' && seq.includes(value)
  if (Array.isArray(seq)) return seq.some((v) => eq(v, value))
  if (isDict(seq)) return typeof value === 'string' && Object.hasOwn(seq, value)
  return false
}

/** `list.remove(value)`: the first equal item, or ValueError. */
export function removeItem(list: unknown[], value: unknown): void {
  const i = list.findIndex((v) => eq(v, value))
  if (i < 0) throw valueError('list.remove(x): x not in list')
  list.splice(i, 1)
}

/** Python's `seq[start:end]`, negative and missing bounds included. */
export function slice<T>(seq: T[], start?: number | null, end?: number | null): T[] {
  const n = seq.length
  const at = (i: number | null | undefined, fallback: number) =>
    i === null || i === undefined ? fallback : i < 0 ? Math.max(0, n + i) : Math.min(i, n)
  const from = at(start, 0)
  const to = at(end, n)
  return to > from ? seq.slice(from, to) : []
}

/** Python's `text[start:end]` on code points. */
export function sliceStr(text: string, start?: number | null, end?: number | null): string {
  return slice([...text], start, end).join('')
}

/** `len(text)` on code points. */
export function len(value: string | unknown[] | PyDict): number {
  if (typeof value === 'string') return [...value].length
  if (Array.isArray(value)) return value.length
  return Object.keys(value).length
}

/** Python's ordering of two values of one kind: numbers, strings, bools, tuples (arrays). */
export function cmp(a: unknown, b: unknown): number {
  const n = (v: unknown): unknown => (v instanceof PyFloat ? v.value : v === true ? 1 : v === false ? 0 : v)
  const x = n(a)
  const y = n(b)
  if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : x > y ? 1 : 0
  if (typeof x === 'string' && typeof y === 'string') return cmpStr(x, y)
  if (Array.isArray(x) && Array.isArray(y)) {
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = cmp(x[i], y[i])
      if (c !== 0) return c
    }
    return x.length - y.length < 0 ? -1 : x.length > y.length ? 1 : 0
  }
  if (isPyObject(x) && isPyObject(y) && 'compare' in x) return (x as unknown as { compare(o: unknown): number }).compare(y)
  throw typeError(`'<' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`)
}

/** Python's type name of a value. */
export function typeName(value: unknown): string {
  if (value === null || value === undefined) return 'NoneType'
  if (typeof value === 'boolean') return 'bool'
  if (value instanceof PyFloat) return 'float'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'string') return 'str'
  if (Array.isArray(value)) return 'list'
  if (isPyObject(value)) return value.pyType
  return 'dict'
}

/**
 * `sorted(items, key=key, reverse=reverse)`: stable, and with `reverse`
 * equal keys keep their order, as Python's does.
 */
export function sorted<T>(items: Iterable<T>, key: (item: T) => unknown = (x) => x, reverse = false): T[] {
  const keyed = [...items].map((item, i) => ({ item, k: key(item), i }))
  keyed.sort((a, b) => {
    const c = cmp(a.k, b.k)
    return (reverse ? -c : c) || a.i - b.i
  })
  return keyed.map((x) => x.item)
}

/** Python's `str.lower()` (Unicode, as JavaScript's). */
export const lower = (s: string): string => s.toLowerCase()
/** Python's `str.upper()`. */
export const upper = (s: string): string => s.toUpperCase()

const WS = ' \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0                　'

/** Python's `str.strip(chars)`; whitespace as Python counts it when `chars` is None. */
export function strip(s: string, chars?: string | null): string {
  return rstrip(lstrip(s, chars), chars)
}
export function lstrip(s: string, chars?: string | null): string {
  const set = chars ?? WS
  const cs = [...s]
  let i = 0
  while (i < cs.length && set.includes(cs[i]!)) i++
  return cs.slice(i).join('')
}
export function rstrip(s: string, chars?: string | null): string {
  const set = chars ?? WS
  const cs = [...s]
  let j = cs.length
  while (j > 0 && set.includes(cs[j - 1]!)) j--
  return cs.slice(0, j).join('')
}

/** Python's `str.split(sep, maxsplit)`; whitespace runs when `sep` is None. */
export function split(s: string, sep?: string | null, maxsplit = -1): string[] {
  if (sep === undefined || sep === null) {
    const out: string[] = []
    let rest = lstrip(s)
    while (rest !== '') {
      if (maxsplit >= 0 && out.length === maxsplit) {
        out.push(rest)
        break
      }
      const cs = [...rest]
      let i = 0
      while (i < cs.length && !WS.includes(cs[i]!)) i++
      out.push(cs.slice(0, i).join(''))
      rest = lstrip(cs.slice(i).join(''))
    }
    return out
  }
  if (sep === '') throw valueError('empty separator')
  const parts = s.split(sep)
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)]
}

/** Python's `str.title()`. */
export function title(s: string): string {
  let prevCased = false
  let out = ''
  for (const ch of s) {
    const isCased = ch.toLowerCase() !== ch.toUpperCase()
    out += isCased ? (prevCased ? ch.toLowerCase() : ch.toUpperCase()) : ch
    prevCased = isCased
  }
  return out
}

/** Python's `str.capitalize()`. */
export function capitalize(s: string): string {
  const cs = [...s]
  if (cs.length === 0) return ''
  return cs[0]!.toUpperCase() + cs.slice(1).join('').toLowerCase()
}

/** Python's `str.isdigit()` for ASCII and the common Unicode digits. */
export function isdigit(s: string): boolean {
  return s.length > 0 && /^\p{Nd}+$/u.test(s)
}

/** Python's `int(text)`: an optional sign, digits and underscores between them, whitespace around. */
export function int(value: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof PyFloat) return value.value
  if (typeof value === 'number') return Math.trunc(value)
  if (typeof value === 'string') {
    const t = strip(value)
    if (/^[+-]?\d+(_\d+)*$/.test(t)) return Number(t.replace(/_/g, ''))
    throw valueError(`invalid literal for int() with base 10: ${strRepr(value)}`)
  }
  throw typeError(`int() argument must be a string, a bytes-like object or a real number, not '${typeName(value)}'`)
}

/** Python's `float(text)`. */
export function float(value: unknown): number | PyFloat {
  if (typeof value === 'boolean') return pf(value ? 1 : 0)
  if (value instanceof PyFloat) return value
  if (typeof value === 'number') return pf(value)
  if (typeof value === 'string') {
    const t = strip(value).replace(/(\d)_(?=\d)/g, '$1')
    const low = t.toLowerCase()
    if (/^[+-]?(inf|infinity)$/.test(low)) return low.startsWith('-') ? -Infinity : Infinity
    if (/^[+-]?nan$/.test(low)) return NaN
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return pf(Number(t))
    throw valueError(`could not convert string to float: ${strRepr(value)}`)
  }
  throw typeError(`float() argument must be a string or a real number, not '${typeName(value)}'`)
}

/** Python's `round(x, n)`: half to even, on the float's exact value. */
export function round(x: number, n = 0): number {
  const m = 10 ** n
  const y = x * m
  const r = Math.round(y)
  const nearest = Math.abs(y - Math.trunc(y)) === 0.5 ? 2 * Math.round(y / 2) : r
  return nearest / m
}

/** Python's `", ".join(...)`, failing as Python does on a non-string item. */
export function join(sep: string, items: unknown[]): string {
  items.forEach((item, i) => {
    if (typeof item !== 'string') throw typeError(`sequence item ${i}: expected str instance, ${typeName(item)} found`)
  })
  return items.join(sep)
}

/** Python's `str.replace(old, new)`, every occurrence. */
export function replaceAll(s: string, old: string, rep: string): string {
  if (old === '') return [...s].map((c) => rep + c).join('') + rep
  return s.split(old).join(rep)
}
