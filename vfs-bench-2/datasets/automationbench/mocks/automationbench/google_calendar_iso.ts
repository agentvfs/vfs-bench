/**
 * `datetime.fromisoformat(text)` as Python 3.13 raises it, for the ports of
 * google_calendar and zoom: the value where it parses (query.ts's
 * `isoDatetime`); a date or time out of range is the constructor's own
 * `ValueError` (`month must be in 1..12`, `hour must be in 0..23`), checked
 * in the constructor's order; anything else is `Invalid isoformat string`.
 * A value that is not a string raises as `str.replace` would on it first,
 * where upstream calls `.replace("Z", "+00:00")`.
 */
import { daysIn } from './pydt.ts'
import type { PyDateTime } from './pydt.ts'
import { PyError, strRepr, typeName, valueError } from './py.ts'
import { isoDatetime } from './query.ts'

/** `text.replace("Z", "+00:00")`, then `datetime.fromisoformat`. */
export function fromIsoZ(text: unknown): PyDateTime {
  if (typeof text !== 'string') throw new PyError('AttributeError', `'${typeName(text)}' object has no attribute 'replace'`)
  return fromisoformat(text.split('Z').join('+00:00'))
}

export function fromisoformat(text: string): PyDateTime {
  const parsed = isoDatetime(text)
  if (parsed !== null) return parsed
  // A well-formed string whose fields are out of range: the constructor's error.
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:.(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,]\d+)?)?)?(?:Z|\s*[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?)?$/su.exec(text)
  if (m !== null) {
    const [, y, mo, d, h, mi, s] = m
    const year = Number(y)
    const month = Number(mo)
    if (year < 1) throw valueError(`year ${year} is out of range`)
    if (month < 1 || month > 12) throw valueError('month must be in 1..12')
    if (Number(d) < 1 || Number(d) > daysIn(year, month)) throw valueError('day is out of range for month')
    if (h !== undefined && Number(h) > 23) throw valueError('hour must be in 0..23')
    if (mi !== undefined && Number(mi) > 59) throw valueError('minute must be in 0..59')
    if (s !== undefined && Number(s) > 59) throw valueError('second must be in 0..59')
  }
  throw valueError(`Invalid isoformat string: ${strRepr(text)}`)
}
