/**
 * Python operations the support apps' ports (freshdesk, zoho_desk, gorgias,
 * helpcrunch) share: iteration as Python iterates a request value, and a
 * stored datetime's `isoformat()`.
 */
import { dt } from './pydt.ts'
import { type Py, PyError, isDict, typeName } from './py.ts'

/** `for x in value` / `list(value)`: a string's characters, a list's items, a dict's keys. */
export function iter(value: unknown): Py[] {
  if (typeof value === 'string') return [...value]
  if (Array.isArray(value)) return [...(value as Py[])]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

/** A stored datetime field, as `record.<field>.isoformat()`. */
export function iso(value: unknown): string {
  return dt(value).isoformat()
}
