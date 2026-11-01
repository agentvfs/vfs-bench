/**
 * The Python semantics ERPBench's world leans on that enterpriseops' and
 * complexmcp's helpers do not already give: `json.dumps` with `sort_keys`
 * and `ensure_ascii=False`, `int()`, `deepcopy` that keeps floats floats,
 * dict lookups that raise as Python's do, and the exceptions upstream's
 * `call_tool` catches.
 */
import { PyError } from '../../../complexmcp/mocks/complexmcp/common.ts'
import { PyFloat, isspace, pyType, repr, reprFloat } from '../../../../workspace/py.ts'

/** An exception upstream's `call_tool` catches: its class and `str(exc)`. */
export class PyExc extends Error {
  readonly kind: string
  constructor(kind: string, message: string) {
    super(message)
    this.kind = kind
  }
}

export const valueError = (message: string) => new PyExc('ValueError', message)
export const typeError = (message: string) => new PyExc('TypeError', message)

/** Whether an error is one upstream's `call_tool` turns into `{"error": ...}`. */
export function caught(error: unknown): error is Error {
  return error instanceof PyExc || error instanceof PyError
}

export type Dict = Record<string, unknown>

export const isDict = (v: unknown): v is Dict =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyFloat) && !(v instanceof Uint8Array)

/** `d[k]`: a missing key raises KeyError, whose text is the key's repr. */
export function at(d: Dict, key: string): unknown {
  if (!Object.hasOwn(d, key)) throw new PyExc('KeyError', repr(key))
  return d[key]
}

/** `obj.get(k, fallback)`, and the AttributeError a non-dict raises. */
export function get(obj: unknown, key: string, fallback: unknown = null): unknown {
  if (!isDict(obj)) throw new PyExc('AttributeError', `'${pyType(obj)}' object has no attribute 'get'`)
  return Object.hasOwn(obj, key) ? obj[key] : fallback
}

/** `d[k] = v` on a dict, `__proto__` included. */
export function put(d: Dict, key: string, value: unknown): void {
  Object.defineProperty(d, key, { value, enumerable: true, writable: true, configurable: true })
}

/** `x.lower()`, and the AttributeError a non-str raises. */
export function lowerOf(x: unknown): string {
  if (typeof x !== 'string') throw new PyExc('AttributeError', `'${pyType(x)}' object has no attribute 'lower'`)
  return x.toLowerCase()
}

/** What `re` raises for a non-str subject. */
export function reSubject(x: unknown): string {
  if (typeof x !== 'string') throw typeError(`expected string or bytes-like object, got '${pyType(x)}'`)
  return x
}

/** `isinstance(x, (int, float))`: bool is an int. */
export const isNumber = (x: unknown): x is number | bigint | boolean | PyFloat =>
  typeof x === 'number' || typeof x === 'bigint' || typeof x === 'boolean' || x instanceof PyFloat

/** A Python number's value as a double. */
export const asNum = (x: number | bigint | boolean | PyFloat): number => (x instanceof PyFloat ? x.v : Number(x))

/** `int(x)` of a JSON value, with CPython's messages. */
export function pyInt(x: unknown): number | bigint {
  if (typeof x === 'boolean') return x ? 1 : 0
  if (typeof x === 'number' || typeof x === 'bigint') return x
  if (x instanceof PyFloat) {
    if (Number.isNaN(x.v)) throw valueError('cannot convert float NaN to integer')
    // shortcut: OverflowError is not caught upstream either; it surfaces as a 500 here.
    if (!Number.isFinite(x.v)) throw new Error('cannot convert float infinity to integer')
    return Math.trunc(x.v) || 0
  }
  if (typeof x === 'string') {
    const cs = Array.from(x)
    let a = 0
    let b = cs.length
    while (a < b && isspace(cs[a]!)) a++
    while (b > a && isspace(cs[b - 1]!)) b--
    const t = cs.slice(a, b).join('')
    if (!/^[+-]?\d(?:_?\d)*$/.test(t)) throw valueError(`invalid literal for int() with base 10: ${repr(x)}`)
    const n = BigInt(t.replace(/_/g, ''))
    return n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : n
  }
  throw typeError(`int() argument must be a string, a bytes-like object or a real number, not '${pyType(x)}'`)
}

/**
 * `json.loads` of what `json.dumps` writes: a number with a point or an
 * exponent a `PyFloat`, an int past 2^53 a bigint, and the `NaN`,
 * `Infinity` and `-Infinity` tokens JSON lacks.
 */
export function pyLoads<T>(text: string): T {
  // Each non-JSON token becomes a string carrying a mark no data can hold.
  const mark = `\u0000${crypto.randomUUID()}`
  let json = text
  if (/NaN|Infinity/.test(text)) {
    json = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!
      if (quoted) {
        json += c
        if (c === '\\') json += text[++i] ?? ''
        else if (c === '"') quoted = false
        continue
      }
      const token = /^(?:-?Infinity|NaN)/.exec(text.slice(i, i + 9))?.[0]
      if (token) {
        json += JSON.stringify(mark + token)
        i += token.length - 1
      } else {
        quoted = c === '"'
        json += c
      }
    }
  }
  return JSON.parse(json, (_key, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'string' && value.startsWith(mark)) return new PyFloat(Number(value.slice(mark.length)))
    if (typeof value !== 'number' || context?.source === undefined) return value
    if (/[.eE]/.test(context.source)) return new PyFloat(value)
    return Number.isSafeInteger(value) ? value : BigInt(context.source)
  }) as T
}

/** `deepcopy` of a JSON value, floats kept floats. */
export function deepcopy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(deepcopy) as T
  if (isDict(v)) {
    const out: Dict = {}
    for (const [k, x] of Object.entries(v)) put(out, k, deepcopy(x))
    return out as T
  }
  return v
}

function cmpCodePoints(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (c !== 0) return c
  }
  return x.length - y.length
}

/** A str as `json.dumps` writes it with `ensure_ascii=False`. */
function jsonStr(s: string): string {
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
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out + '"'
}

function jsonFloat(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
  return reprFloat(v)
}

/**
 * `json.dumps(v, sort_keys=True, ensure_ascii=False)`, or with `compact`
 * the `separators=(",", ":")` upstream's `_json` uses.
 */
export function dumps(v: unknown, compact = false): string {
  const [item, kv] = compact ? [',', ':'] : [', ', ': ']
  const write = (x: unknown): string => {
    if (x === null || x === undefined) return 'null'
    if (x instanceof PyFloat) return jsonFloat(x.v)
    if (typeof x === 'number') return Number.isInteger(x) ? String(x) : jsonFloat(x)
    if (typeof x === 'bigint') return x.toString()
    if (typeof x === 'boolean') return x ? 'true' : 'false'
    if (typeof x === 'string') return jsonStr(x)
    if (Array.isArray(x)) return `[${x.map(write).join(item)}]`
    const keys = Object.keys(x as Dict).sort(cmpCodePoints)
    return `{${keys.map((k) => `${jsonStr(k)}${kv}${write((x as Dict)[k])}`).join(item)}}`
  }
  return write(v)
}
