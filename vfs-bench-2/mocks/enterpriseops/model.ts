/**
 * A request body as upstream's pydantic models (v2, lax mode) read one:
 * each field coerced to its type or reported, as FastAPI reports a body it
 * cannot read (its 422 `detail`). A port states each of upstream's models
 * as a `Model`, field by field, in upstream's order.
 */
import { PyFloat, repr } from './py.ts'

export type FieldType =
  | 'int'
  | 'float'
  | 'str'
  | 'bool'
  | 'dict'
  | 'any'
  /** A `Literal[...]`. */
  | { enum: readonly string[] }
  | { list: FieldType }

export interface Field {
  type: FieldType
  /** No default: the body must give it. */
  required?: boolean
  /** `Optional[...]`: null is a value. */
  nullable?: boolean
  default?: unknown
  minLength?: number
  maxLength?: number
  ge?: number
  gt?: number
  le?: number
  lt?: number
}

export type Model = Record<string, Field>

/** One of pydantic's errors, as FastAPI's 422 lists it. */
export interface FieldError {
  type: string
  loc: (string | number)[]
  msg: string
  input: unknown
  ctx?: Record<string, unknown>
}

export type Validated = { ok: true; value: Record<string, unknown> } | { ok: false, errors: FieldError[] }

const BOOL_TRUE = new Set(['1', 'on', 't', 'true', 'y', 'yes'])
const BOOL_FALSE = new Set(['0', 'off', 'f', 'false', 'n', 'no'])

const isNum = (v: unknown): v is number | PyFloat => typeof v === 'number' || v instanceof PyFloat
const numOf = (v: number | PyFloat) => (v instanceof PyFloat ? v.v : v)

function enumText(values: readonly string[]): string {
  const quoted = values.map((v) => `'${v}'`)
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`
}

/** A value as one field's type reads it, or the error pydantic gives. */
function coerce(type: FieldType, value: unknown, loc: (string | number)[]): { value: unknown } | { error: FieldError; more?: FieldError[] } {
  const fail = (t: string, msg: string, ctx?: Record<string, unknown>) => ({ error: { type: t, loc, msg, input: value, ...(ctx ? { ctx } : {}) } })
  if (type === 'any') return { value }
  if (type === 'int') {
    if (typeof value === 'boolean') return { value: value ? 1 : 0 }
    if ((typeof value === 'number' && Number.isInteger(value)) || typeof value === 'bigint') return { value }
    if (value instanceof PyFloat) {
      return Number.isInteger(value.v) ? { value: value.v } : fail('int_from_float', 'Input should be a valid integer, got a number with a fractional part')
    }
    if (typeof value === 'string') {
      const t = value.trim()
      if (/^[+-]?\d+$/.test(t)) return { value: Number(t) }
      return fail('int_parsing', 'Input should be a valid integer, unable to parse string as an integer')
    }
    return fail('int_type', 'Input should be a valid integer')
  }
  if (type === 'float') {
    if (typeof value === 'boolean') return { value: new PyFloat(value ? 1 : 0) }
    if (isNum(value)) return { value: new PyFloat(numOf(value)) }
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value.trim()))) return { value: new PyFloat(Number(value.trim())) }
    if (typeof value === 'string') return fail('float_parsing', 'Input should be a valid number, unable to parse string as a number')
    return fail('float_type', 'Input should be a valid number')
  }
  if (type === 'str') {
    if (typeof value === 'string') return { value }
    return fail('string_type', 'Input should be a valid string')
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return { value }
    if (isNum(value) && (numOf(value) === 0 || numOf(value) === 1)) return { value: numOf(value) === 1 }
    if (typeof value === 'string') {
      const t = value.trim().toLowerCase()
      if (BOOL_TRUE.has(t)) return { value: true }
      if (BOOL_FALSE.has(t)) return { value: false }
      return fail('bool_parsing', 'Input should be a valid boolean, unable to interpret input')
    }
    return fail('bool_type', 'Input should be a valid boolean')
  }
  if (type === 'dict') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof PyFloat)) return { value }
    return fail('dict_type', 'Input should be a valid dictionary')
  }
  if ('enum' in type) {
    if (typeof value === 'string' && type.enum.includes(value)) return { value }
    return fail('literal_error', `Input should be ${enumText(type.enum)}`, { expected: enumText(type.enum) })
  }
  if (!Array.isArray(value)) return fail('list_type', 'Input should be a valid list')
  const out: unknown[] = []
  const errors: FieldError[] = []
  value.forEach((item, i) => {
    const r = coerce(type.list, item, [...loc, i])
    if ('error' in r) errors.push(r.error, ...(r.more ?? []))
    else out.push(r.value)
  })
  // pydantic reports each item that does not fit, not just the first.
  return errors.length > 0 ? { error: errors[0]!, more: errors.slice(1) } : { value: out }
}

function constraints(field: Field, value: unknown, loc: (string | number)[]): FieldError | null {
  const fail = (type: string, msg: string, ctx: Record<string, unknown>) => ({ type, loc, msg, input: value, ctx })
  if (typeof value === 'string' || Array.isArray(value)) {
    const n = typeof value === 'string' ? Array.from(value).length : value.length
    const what = typeof value === 'string' ? 'String' : 'List'
    const unit = typeof value === 'string' ? 'character' : 'item'
    if (field.minLength !== undefined && n < field.minLength) {
      return fail(`${what.toLowerCase()}_too_short`, `${what} should have at least ${field.minLength} ${unit}${field.minLength === 1 ? '' : 's'}`, { min_length: field.minLength })
    }
    if (field.maxLength !== undefined && n > field.maxLength) {
      return fail(`${what.toLowerCase()}_too_long`, `${what} should have at most ${field.maxLength} ${unit}${field.maxLength === 1 ? '' : 's'}`, { max_length: field.maxLength })
    }
  }
  if (isNum(value)) {
    const v = numOf(value)
    if (field.ge !== undefined && v < field.ge) return fail('greater_than_equal', `Input should be greater than or equal to ${field.ge}`, { ge: field.ge })
    if (field.gt !== undefined && v <= field.gt) return fail('greater_than', `Input should be greater than ${field.gt}`, { gt: field.gt })
    if (field.le !== undefined && v > field.le) return fail('less_than_equal', `Input should be less than or equal to ${field.le}`, { le: field.le })
    if (field.lt !== undefined && v >= field.lt) return fail('less_than', `Input should be less than ${field.lt}`, { lt: field.lt })
  }
  return null
}

/** A body as a model reads it: every field, its default where the body has none. */
export function validate(model: Model, body: Record<string, unknown>): Validated {
  const value: Record<string, unknown> = {}
  const errors: FieldError[] = []
  for (const [name, field] of Object.entries(model)) {
    const loc = ['body', name]
    if (!(name in body)) {
      if (field.required) errors.push({ type: 'missing', loc, msg: 'Field required', input: body })
      else value[name] = field.default ?? null
      continue
    }
    const given = body[name]
    if (given === null && (field.nullable || !field.required)) {
      if (field.nullable) {
        value[name] = null
        continue
      }
    }
    const r = coerce(field.type, given, loc)
    if ('error' in r) {
      errors.push(r.error, ...(r.more ?? []))
      continue
    }
    const bad = constraints(field, r.value, loc)
    if (bad) errors.push(bad)
    else value[name] = r.value
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

/** FastAPI's 422 `detail`, as Python's `str` prints the list. */
export function detailText(errors: FieldError[]): string {
  return repr(errors.map((e) => ({ ...e, loc: e.loc })))
}
