/**
 * Python operations the hubspot and docusign ports need on request values
 * whose type the caller chose: iteration, subscription and `setattr` on a
 * validate-assignment model, failing as Python does.
 */
import { ValidationError, assign, model } from './models.ts'
import { type Py, type PyDict, PyError, isDict, str, typeName } from './py.ts'
import type { World } from './world.ts'

/** `for x in value`: a list's items, a str's characters, a dict's keys; else TypeError. */
export function iter(value: unknown): Py[] {
  if (Array.isArray(value)) return value as Py[]
  if (typeof value === 'string') return [...value]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

/** `value[key]` for a str key. */
export function item(value: unknown, key: string): Py {
  if (isDict(value)) {
    if (!Object.hasOwn(value, key)) throw new PyError('KeyError', `'${key}'`)
    return value[key]!
  }
  if (typeof value === 'string') throw new PyError('TypeError', "string indices must be integers, not 'str'")
  if (Array.isArray(value)) throw new PyError('TypeError', 'list indices must be integers or slices, not str')
  throw new PyError('TypeError', `'${typeName(value)}' object is not subscriptable`)
}

/** Whether a model has a field of that name, as `hasattr` finds one. */
export function isField(modelName: string, name: string): boolean {
  return model(modelName).fields.some((f) => f.name === name)
}

/**
 * Upstream's `if hasattr(obj, key): try: setattr(obj, key, value) except
 * Exception: obj.properties[key] = str(value) else: obj.properties[key] =
 * str(value)`: a field takes the value if it validates; anything else
 * (another attribute, which a validate-assignment model with
 * `extra="forbid"` refuses, or no attribute) lands in `properties`.
 */
export function setOrProperty(modelName: string, record: PyDict, key: string, value: unknown, world: World): void {
  if (isField(modelName, key)) {
    try {
      assign(modelName, record, key, value, world)
      return
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
    }
  }
  ;(record.properties as PyDict)[key] = str(value)
}
