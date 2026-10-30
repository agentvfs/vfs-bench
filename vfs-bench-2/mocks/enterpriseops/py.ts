/**
 * Python's values as EnterpriseOps-Gym's servers store and print them.
 *
 * Upstream's servers are Python over `sqlite3`, so an int and a float are
 * two types: a column read back as REAL prints `5.0`, an INTEGER `5`. Here
 * a Python int is a JS number (a bigint past 2^53) and a float a `PyFloat`
 * (ComplexMCP's, mocks/complexmcp/py.ts), both as `sqlite.ts` reads them and
 * as `loads` reads a request's JSON.
 *
 * A tool's reply is `json.dumps` of what the server returns: `dumps` here,
 * with Python's default separators and `ensure_ascii`.
 */
import { PyFloat, loads, repr, reprFloat, reprStr, str } from '../complexmcp/py.ts'

export { PyFloat, loads, repr, reprStr, str }

/** Python's `json.dumps(value)`: `, ` and `: `, non-ASCII escaped, floats as `repr`. */
export function dumps(value: unknown, indent?: number): string {
  return write(value, indent, '')
}

function write(value: unknown, indent: number | undefined, pad: string): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof PyFloat) return jsonFloat(value.v)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : jsonFloat(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return jsonString(value)
  if (value instanceof Date) throw new TypeError('Object of type datetime is not JSON serializable')
  const inner = indent === undefined ? '' : pad + ' '.repeat(indent)
  const open = indent === undefined ? '' : `\n${inner}`
  const close = indent === undefined ? '' : `\n${pad}`
  const sep = indent === undefined ? ', ' : `,\n${inner}`
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${open}${value.map((v) => write(v, indent, inner)).join(sep)}${close}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return '{}'
  return `{${open}${entries.map(([k, v]) => `${jsonString(k)}: ${write(v, indent, inner)}`).join(sep)}${close}}`
}

function jsonFloat(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
  return reprFloat(v)
}

/** A string as `json.dumps` writes it with `ensure_ascii`. */
export function jsonString(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ch = s[i]!
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
  return out + '"'
}

/** Python's `datetime.isoformat(sep, 'seconds')` of a UTC instant, naive. */
export function isoSeconds(ms: number, sep = 'T'): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', sep)
}

/** Python's `datetime.isoformat(sep)` of a UTC instant, naive: microseconds unless they are 0. */
export function isoMicros(ms: number, sep = 'T'): string {
  const d = new Date(ms).toISOString()
  const frac = d.slice(20, 23)
  return frac === '000' ? d.slice(0, 19).replace('T', sep) : `${d.slice(0, 19).replace('T', sep)}.${frac}000`
}
