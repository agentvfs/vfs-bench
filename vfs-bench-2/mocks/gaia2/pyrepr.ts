/**
 * Python's `repr()`, `str()` and `type(x).__name__` of the values JSON
 * gives (`json.loads`' str, int, float, bool, None, list and dict), for the
 * Gaia2 fakes, whose messages print them as upstream's f-strings do.
 */
import { PyFloat, floatRepr } from './pyjson.ts'

/** Whether Python's `str.isprintable()` holds for one code point (Unicode categories C* and Z* but space are not). */
const printable = (ch: string): boolean => ch === ' ' || !/[\p{C}\p{Z}]/u.test(ch)

/** `repr(s)` of a str: single quotes unless it has a `'` and no `"`, escapes as CPython's. */
export function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = quote
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === quote || ch === '\\') out += `\\${ch}`
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`
    else if (c < 0x7f) out += ch
    else if (printable(ch)) out += ch
    else if (c <= 0xff) out += `\\x${c.toString(16).padStart(2, '0')}`
    else if (c <= 0xffff) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += `\\U${c.toString(16).padStart(8, '0')}`
  }
  return out + quote
}

/** `repr(value)`. */
export function repr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (value instanceof PyFloat) return floatRepr(value.value)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatRepr(value)
  if (typeof value === 'string') return strRepr(value)
  if (Array.isArray(value)) return `[${value.map(repr).join(', ')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${strRepr(k)}: ${repr(v)}`)
    .join(', ')}}`
}

/** `str(value)`: a str as itself, anything else as its repr. */
export function pyStr(value: unknown): string {
  return typeof value === 'string' ? value : repr(value)
}

/** `type(value).__name__`. */
export function typeName(value: unknown): string {
  if (value === null || value === undefined) return 'NoneType'
  if (typeof value === 'boolean') return 'bool'
  if (value instanceof PyFloat) return 'float'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'string') return 'str'
  if (Array.isArray(value)) return 'list'
  return 'dict'
}
