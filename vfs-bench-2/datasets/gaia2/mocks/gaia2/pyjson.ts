/**
 * JSON as Python's `json` module reads and writes it, for the Gaia2 fakes,
 * whose replies and state are gaia2-cli's `json.dumps` output.
 *
 * Python keeps a float a float: `1.0` reads back as a float and prints as
 * `1.0`, where JavaScript has one number type and prints `1`. A float
 * whose value is whole is kept as a `PyFloat` here, read from JSON text
 * with a `.` or an exponent, or made by `pf()` where upstream computes a
 * float (`time.time()`, a division). Any other number prints as an int if
 * it is whole and as Python's `repr(float)` if not.
 *
 * `dumps` is `json.dumps` with its defaults (`ensure_ascii=True`, `", "` and
 * `": "`), or with `indent`, which separates items with `","` and a newline.
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

export type Py = string | number | boolean | null | PyFloat | Py[] | { [key: string]: Py }
export type PyDict = { [key: string]: Py }

/** A computed float: a `PyFloat` where it is whole, so it prints as Python's. */
export function pf(value: number): number | PyFloat {
  return Number.isInteger(value) ? new PyFloat(value) : value
}

/** A number of either kind, as a JavaScript number. */
export function num(value: unknown): number {
  return value instanceof PyFloat ? value.value : (value as number)
}

/** Whether a value is a Python float or int (not a bool). */
export function isNumber(value: unknown): value is number | PyFloat {
  return typeof value === 'number' || value instanceof PyFloat
}

/** Whether a value is a Python float: a `PyFloat`, or a number with a fraction. */
export function isFloat(value: unknown): boolean {
  return value instanceof PyFloat || (typeof value === 'number' && !Number.isInteger(value))
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

/** `repr(float)`: the shortest digits that read back, in Python's notation. */
export function floatRepr(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'
  const [mantissa, exp] = value.toExponential().split('e') as [string, string]
  const negative = mantissa.startsWith('-')
  const digits = mantissa.replace('-', '').replace('.', '')
  const e = Number(exp)
  let out: string
  if (e >= -4 && e < 16) {
    // Python's repr is fixed for 1e-4 <= abs(x) < 1e16, exponential otherwise.
    if (e < 0) out = `0.${'0'.repeat(-e - 1)}${digits}`
    else if (digits.length <= e + 1) out = `${digits}${'0'.repeat(e + 1 - digits.length)}.0`
    else out = `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`
  } else {
    const m = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`
    out = `${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }
  return negative ? `-${out}` : out
}

/** A string as `json.dumps` writes it with `ensure_ascii=True`. */
export function quote(text: string): string {
  let out = '"'
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ch = text[i]!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\b') out += '\\b'
    else if (ch === '\f') out += '\\f'
    else if (c < 0x20 || c > 0x7e) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

function scalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value instanceof PyFloat) return floatRepr(value.value)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatRepr(value)
  if (typeof value === 'string') return quote(value)
  return undefined
}

/** `json.dumps(value)`, or with `indent`. */
export function dumps(value: unknown, indent?: number): string {
  const walk = (v: unknown, level: number): string => {
    const s = scalar(v)
    if (s !== undefined) return s
    const pad = indent === undefined ? '' : `\n${' '.repeat(indent * (level + 1))}`
    const end = indent === undefined ? '' : `\n${' '.repeat(indent * level)}`
    const sep = indent === undefined ? ', ' : ','
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      return `[${v.map((x) => `${pad}${walk(x, level + 1)}`).join(sep)}${end}]`
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
    if (entries.length === 0) return '{}'
    return `{${entries.map(([k, x]) => `${pad}${quote(k)}: ${walk(x, level + 1)}`).join(sep)}${end}}`
  }
  return walk(value, 0)
}

/** A deep copy that keeps `PyFloat`s. */
export function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T
  if (value !== null && typeof value === 'object' && !(value instanceof PyFloat)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T
  }
  return value
}
