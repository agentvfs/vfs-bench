/**
 * Upstream's Pydantic models, as far as the handlers build and change
 * records: `data/models.json` (harbor/automationbench.py writes it from the
 * models themselves) gives each model's fields in order, their types,
 * defaults and default factories, and its validators.
 *
 * The world keeps every record as `model_dump(mode="json")` writes it. So
 * - `build(model, data)` is the model's constructor: its `before`
 *   validators, then each field validated (Pydantic's lax mode) or
 *   defaulted, in order, and `extra="forbid"`; a failure is a
 *   `ValidationError` whose `errors()` are Pydantic's. It returns the
 *   record's JSON.
 * - `assign(model, record, field, value)` is `record.field = value` under
 *   `validate_assignment`.
 * - `pyValue(type, json)` is a stored value as Python holds it (a datetime
 *   as a `PyDateTime`), for code that formats or compares it, and
 *   `modelDump(model, record)` is `model_dump()` (Python mode).
 *
 * A default factory is upstream's function by name (`FACTORIES`, filled by
 * each service's port), or a lambda by `lambda:<model>.<field>`; a `before`
 * validator by `<model>.<validator>` (`BEFORE`). One that has no port fails
 * loudly, so a record is never built some other way.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PyDate, PyDateTime, parseDate, parseDatetime } from './pydt.ts'
import {
  type Py,
  type PyDict,
  type PyObject,
  PyFloat,
  copy,
  floatRepr,
  isDict,
  isFloat,
  isNumber,
  num,
  repr,
  strRepr,
  typeName,
} from './py.ts'
import type { World } from './world.ts'

export type TypeDesc =
  | { k: 'str' | 'int' | 'float' | 'bool' | 'datetime' | 'date' | 'decimal' | 'any' | 'none' }
  | { k: 'literal'; values: Py[]; enum?: string }
  | { k: 'list' | 'set'; item: TypeDesc }
  | { k: 'dict'; key: TypeDesc; value: TypeDesc }
  | { k: 'union'; of: TypeDesc[] }
  | { k: 'model'; name: string }

export interface FieldDesc {
  name: string
  type: TypeDesc
  alias?: string
  default?: Py
  factory?: string
  required?: boolean
  source?: string
}

export interface ModelDesc {
  fields: FieldDesc[]
  extra: string | null
  validate_assignment: boolean
  before: string[]
  after: string[]
  field_validators: Record<string, string[]>
}

const HERE = dirname(fileURLToPath(import.meta.url))
export const MODELS: Record<string, ModelDesc> = JSON.parse(readFileSync(join(HERE, 'data', 'models.json'), 'utf8')) as Record<string, ModelDesc>

/** One of Pydantic's error details. */
export interface ErrorDetail {
  type: string
  loc: (string | number)[]
  msg: string
  input: unknown
}

/** `pydantic.ValidationError`. */
export class ValidationError extends Error {
  readonly details: ErrorDetail[]
  readonly title: string
  constructor(title: string, details: ErrorDetail[]) {
    super(`${details.length} validation error${details.length === 1 ? '' : 's'} for ${title}`)
    this.title = title
    this.details = details
  }
  errors(): ErrorDetail[] {
    return this.details
  }
  /** `str(e)`, as Pydantic prints it. */
  override toString(): string {
    const lines = [this.message]
    for (const d of this.details) {
      lines.push(d.loc.map(String).join('.'))
      lines.push(`  ${d.msg} [type=${d.type}, input_value=${inputRepr(d.input)}, input_type=${typeName(d.input)}]`)
      lines.push(`    For further information visit https://errors.pydantic.dev/2.12/v/${d.type}`)
    }
    return lines.join('\n')
  }
}

function inputRepr(value: unknown): string {
  const text = repr(value)
  return text.length > 50 ? `${text.slice(0, 24)}...${text.slice(-24)}` : text
}

/** A Python `Decimal`, kept as its text. */
export class PyDecimal implements PyObject {
  readonly pyType = 'Decimal'
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
  pyStr(): string {
    return this.text
  }
  pyRepr(): string {
    return `Decimal('${this.text}')`
  }
  valueOf(): number {
    return Number(this.text)
  }
}

/** Upstream's default factories by name, each service's registered by its port. */
export const FACTORIES: Record<string, (world: World) => Py> = {
  list: () => [],
  dict: () => ({}),
  set: () => [],
  // `datetime.now` itself: the naive wall time, which is UTC's.
  'datetime.now': (world) => world.now().replace({ offset: null }).json(),
}

/** Upstream's `before` model validators by `<model>.<name>`: the raw input in, the input the fields see out. */
export const BEFORE: Record<string, (data: unknown, world: World) => unknown> = {}

/** Upstream's field validators (`mode="before"` unless noted) by `<model>.<name>`. */
export const FIELD_VALIDATORS: Record<string, (value: unknown, world: World) => unknown> = {}

class Failure {
  readonly details: ErrorDetail[]
  constructor(details: ErrorDetail[]) {
    this.details = details
  }
}

const fail = (type: string, msg: string, input: unknown, loc: (string | number)[] = []): Failure =>
  new Failure([{ type, loc, msg, input }])

const BOOL_TRUE = new Set(['1', 'on', 't', 'true', 'y', 'yes'])
const BOOL_FALSE = new Set(['0', 'off', 'f', 'false', 'n', 'no'])

function literalMessage(values: Py[]): string {
  const shown = values.map((v) => (typeof v === 'string' ? strRepr(v) : repr(v)))
  return `Input should be ${shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}`}`
}

/** Whether a value is exactly of a type, as Pydantic's strict pass of a smart union checks. */
function exact(type: TypeDesc, value: unknown): boolean {
  switch (type.k) {
    case 'none':
      return value === null || value === undefined
    case 'str':
      return typeof value === 'string'
    case 'int':
      return typeof value === 'number' && Number.isInteger(value)
    case 'float':
      return isFloat(value)
    case 'bool':
      return typeof value === 'boolean'
    case 'datetime':
      return value instanceof PyDateTime
    case 'date':
      return value instanceof PyDate && !(value instanceof PyDateTime)
    case 'list':
    case 'set':
      return Array.isArray(value)
    case 'dict':
      return isDict(value)
    case 'model':
      return isDict(value)
    case 'literal':
      return type.values.some((v) => v === value)
    case 'decimal':
      return value instanceof PyDecimal
    default:
      return false
  }
}

/** A value validated against a type, as JSON: a `Failure` where Pydantic would fail. */
function check(type: TypeDesc, value: unknown, world: World, loc: (string | number)[]): Py | Failure {
  switch (type.k) {
    case 'any':
      return toJson(value)
    case 'none':
      return value === null || value === undefined ? null : fail('none_required', 'Input should be None', value, loc)
    case 'str':
      return typeof value === 'string' ? value : fail('string_type', 'Input should be a valid string', value, loc)
    case 'int': {
      if (typeof value === 'boolean') return value ? 1 : 0
      if (isNumber(value)) {
        const n = num(value)
        if (Number.isInteger(n)) return n
        if (!Number.isFinite(n)) return fail('finite_number', 'Input should be a finite number', value, loc)
        return fail('int_from_float', 'Input should be a valid integer, got a number with a fractional part', value, loc)
      }
      if (typeof value === 'string') {
        const t = value.trim()
        if (/^[+-]?\d+$/.test(t)) return Number(t)
        if (/^[+-]?\d+\.0*$/.test(t)) return Number(t)
        if (/^[+-]?\d*\.\d+$/.test(t)) return fail('int_from_float', 'Input should be a valid integer, got a number with a fractional part', value, loc)
        return fail('int_parsing', 'Input should be a valid integer, unable to parse string as an integer', value, loc)
      }
      return fail('int_type', 'Input should be a valid integer', value, loc)
    }
    case 'float': {
      if (typeof value === 'boolean') return new PyFloat(value ? 1 : 0)
      if (isNumber(value)) return Number.isInteger(num(value)) ? new PyFloat(num(value)) : num(value)
      if (typeof value === 'string') {
        const t = value.trim()
        if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
          const n = Number(t)
          return Number.isInteger(n) ? new PyFloat(n) : n
        }
        if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity
        if (/^[+-]?nan$/i.test(t)) return NaN
        return fail('float_parsing', 'Input should be a valid number, unable to parse string as a number', value, loc)
      }
      return fail('float_type', 'Input should be a valid number', value, loc)
    }
    case 'bool': {
      if (typeof value === 'boolean') return value
      if (isNumber(value)) {
        const n = num(value)
        if (n === 0 || n === 1) return n === 1
        return fail('bool_parsing', 'Input should be a valid boolean, unable to interpret input', value, loc)
      }
      if (typeof value === 'string') {
        const t = value.toLowerCase()
        if (BOOL_TRUE.has(t)) return true
        if (BOOL_FALSE.has(t)) return false
        return fail('bool_parsing', 'Input should be a valid boolean, unable to interpret input', value, loc)
      }
      return fail('bool_type', 'Input should be a valid boolean', value, loc)
    }
    case 'datetime': {
      const parsed = parseDatetime(value)
      return parsed instanceof PyDateTime ? parsed.json() : fail(parsed.type, parsed.error, value, loc)
    }
    case 'date': {
      const parsed = parseDate(value)
      return parsed instanceof PyDate ? parsed.isoformat() : fail(parsed.type, parsed.error, value, loc)
    }
    case 'decimal': {
      if (value instanceof PyDecimal) {
        // Pydantic's Decimal refuses NaN and infinities (allow_inf_nan off).
        if (/^[+-]?(inf|infinity|s?nan\d*)$/i.test(value.text)) return fail('finite_number', 'Input should be a finite number', value, loc)
        return value.text
      }
      if (typeof value === 'boolean') return fail('decimal_type', 'Decimal input should be an integer, float, string or Decimal object', value, loc)
      if (isNumber(value)) return value instanceof PyFloat ? floatRepr(value.value) : Number.isInteger(value) ? String(value) : floatRepr(value)
      if (typeof value === 'string') {
        const t = value.trim()
        if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return t
        return fail('decimal_parsing', 'Input should be a valid decimal', value, loc)
      }
      return fail('decimal_type', 'Decimal input should be an integer, float, string or Decimal object', value, loc)
    }
    case 'literal': {
      const hit = type.values.find((v) => v === value || (isNumber(v) && isNumber(value) && num(v) === num(value)))
      return hit !== undefined ? hit : fail(type.enum ? 'enum' : 'literal_error', literalMessage(type.values), value, loc)
    }
    case 'list':
    case 'set': {
      if (!Array.isArray(value)) return fail(type.k === 'list' ? 'list_type' : 'set_type', `Input should be a valid ${type.k}`, value, loc)
      const out: Py[] = []
      const errors: ErrorDetail[] = []
      value.forEach((item, i) => {
        const r = check(type.item, item, world, [...loc, i])
        if (r instanceof Failure) errors.push(...r.details)
        else if (type.k === 'list' || !out.some((x) => x === r)) out.push(r)
      })
      return errors.length > 0 ? new Failure(errors) : out
    }
    case 'dict': {
      if (!isDict(value)) return fail('dict_type', 'Input should be a valid dictionary', value, loc)
      const out: PyDict = {}
      const errors: ErrorDetail[] = []
      for (const [k, v] of Object.entries(value)) {
        const r = check(type.value, v, world, [...loc, k])
        if (r instanceof Failure) errors.push(...r.details)
        else out[k] = r
      }
      return errors.length > 0 ? new Failure(errors) : out
    }
    case 'union': {
      if ((value === null || value === undefined) && type.of.some((m) => m.k === 'none')) return null
      // `Optional[X]` is Pydantic's nullable X: X's errors, at X's loc.
      const members = type.of.filter((m) => m.k !== 'none')
      if (members.length === 1) return check(members[0]!, value, world, loc)
      if (members.length < type.of.length) return check({ k: 'union', of: members }, value, world, loc)
      // Smart mode: an exact match first, then the first that validates.
      for (const m of members) if (m.k !== 'none' && exact(m, value)) {
        const r = check(m, value, world, loc)
        if (!(r instanceof Failure)) return r
      }
      const errors: ErrorDetail[] = []
      for (const m of members) {
        const r = check(m, value, world, [...loc, unionTag(m)])
        if (!(r instanceof Failure)) return r
        errors.push(...r.details)
      }
      return new Failure(errors)
    }
    case 'model': {
      if (!isDict(value)) {
        const name = type.name.split('.').pop()!
        return fail('model_type', `Input should be a valid dictionary or instance of ${name}`, value, loc)
      }
      try {
        return build(type.name, value, world)
      } catch (error) {
        if (error instanceof ValidationError) return new Failure(error.details.map((d) => ({ ...d, loc: [...loc, ...d.loc] })))
        throw error
      }
    }
  }
}

function unionTag(type: TypeDesc): string {
  switch (type.k) {
    case 'model':
      return type.name.split('.').pop()!
    case 'list':
      return `list[${unionTag(type.item)}]`
    case 'set':
      return `set[${unionTag(type.item)}]`
    case 'dict':
      return `dict[${unionTag(type.key)},${unionTag(type.value)}]`
    case 'literal':
      return `literal[${type.values.map((v) => repr(v)).join(',')}]`
    case 'union':
      return type.of.map(unionTag).join('|')
    case 'none':
      return 'none'
    default:
      return type.k
  }
}

/** A Python value as the JSON Pydantic's JSON mode writes for an `Any` field. */
export function toJson(value: unknown): Py {
  if (value instanceof PyDateTime || value instanceof PyDate) return value.json()
  if (value instanceof PyDecimal) return value.text
  if (Array.isArray(value)) return value.map(toJson)
  if (isDict(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]))
  if (value === undefined) return null
  return value as Py
}

export function model(name: string): ModelDesc {
  const found = MODELS[name]
  if (found === undefined) throw new Error(`no model ${name} in models.json`)
  return found
}

export function field(modelName: string, name: string): FieldDesc {
  const found = model(modelName).fields.find((f) => f.name === name)
  if (found === undefined) throw new Error(`${modelName} has no field ${name}`)
  return found
}

function title(name: string): string {
  return name.split('.').pop()!
}

function defaultOf(modelName: string, f: FieldDesc, world: World): Py {
  if (f.factory === undefined) return copy(f.default ?? null)
  if (f.factory.startsWith('model:')) return build(f.factory.slice(6), {}, world)
  const factory = FACTORIES[f.factory]
  if (factory === undefined) throw new Error(`${modelName}.${f.name}: no port of the default factory ${f.factory}${f.source ? ` (${f.source})` : ''}`)
  return factory(world)
}

/**
 * `Model(**data)`: the record's JSON, its fields in the model's order.
 * Throws `ValidationError` as Pydantic does.
 */
export function build(modelName: string, data: unknown, world: World): PyDict {
  const m = model(modelName)
  let input: unknown = data
  for (const name of m.before) {
    const validator = BEFORE[`${modelName}.${name}`]
    if (validator === undefined) throw new Error(`${modelName}: no port of the before validator ${name}`)
    input = validator(input, world)
  }
  if (!isDict(input)) throw new ValidationError(title(modelName), [{ type: 'model_type', loc: [], msg: `Input should be a valid dictionary or instance of ${title(modelName)}`, input }])
  const given = input
  const out: PyDict = {}
  const errors: ErrorDetail[] = []
  const known = new Set<string>()
  for (const f of m.fields) {
    const key = f.alias !== undefined && Object.hasOwn(given, f.alias) ? f.alias : f.name
    known.add(f.alias ?? f.name)
    known.add(f.name)
    if (!Object.hasOwn(given, key) || given[key] === undefined) {
      if (f.required) errors.push({ type: 'missing', loc: [f.alias ?? f.name], msg: 'Field required', input: given })
      else out[f.name] = defaultOf(modelName, f, world)
      continue
    }
    let raw: unknown = given[key]
    for (const [name, fields] of Object.entries(m.field_validators)) {
      if (!fields.includes(f.name)) continue
      const validator = FIELD_VALIDATORS[`${modelName}.${name}`]
      if (validator === undefined) throw new Error(`${modelName}: no port of the field validator ${name}`)
      raw = validator(raw, world)
    }
    // Pydantic's loc is the key the value came in under: the alias, or the
    // name where the model populates by name.
    const r = check(f.type, raw, world, [key])
    if (r instanceof Failure) errors.push(...r.details)
    else out[f.name] = r
  }
  if (m.extra === 'forbid') {
    for (const k of Object.keys(given)) {
      if (!known.has(k)) errors.push({ type: 'extra_forbidden', loc: [k], msg: 'Extra inputs are not permitted', input: given[k] })
    }
  }
  if (errors.length > 0) throw new ValidationError(title(modelName), errors)
  if (m.after.length > 0) throw new Error(`${modelName}: no port of the after validators ${m.after.join(', ')}`)
  return out
}

/** `record.<name> = value` under `validate_assignment`. */
export function assign(modelName: string, record: PyDict, name: string, value: unknown, world: World): void {
  const m = model(modelName)
  const f = m.fields.find((x) => x.name === name)
  if (f === undefined) {
    throw new ValidationError(title(modelName), [{ type: 'no_such_attribute', loc: [name], msg: `Object has no attribute '${name}'`, input: value }])
  }
  if (!m.validate_assignment) {
    record[name] = toJson(value)
    return
  }
  let raw = value
  for (const [vname, fields] of Object.entries(m.field_validators)) {
    if (!fields.includes(name)) continue
    const validator = FIELD_VALIDATORS[`${modelName}.${vname}`]
    if (validator === undefined) throw new Error(`${modelName}: no port of the field validator ${vname}`)
    raw = validator(raw, world)
  }
  const r = check(f.type, raw, world, [name])
  if (r instanceof Failure) throw new ValidationError(title(modelName), r.details)
  record[name] = r
}

/** A stored value as Python holds it: datetimes, dates and Decimals as objects, nested models as dicts. */
export function pyValue(type: TypeDesc, value: Py): Py {
  if (value === null) return null
  switch (type.k) {
    case 'datetime':
      return typeof value === 'string' ? (parseDatetime(value) as PyDateTime) : value
    case 'date':
      return typeof value === 'string' ? (parseDate(value) as PyDate) : value
    case 'decimal':
      return typeof value === 'string' ? new PyDecimal(value) : value
    case 'list':
    case 'set':
      return Array.isArray(value) ? value.map((v) => pyValue(type.item, v)) : value
    case 'dict':
      return isDict(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pyValue(type.value, v)])) : value
    case 'model':
      return isDict(value) ? modelDump(type.name, value) : value
    case 'union': {
      for (const m of type.of) {
        if (m.k === 'none') continue
        if (m.k === 'datetime' && typeof value === 'string' && parseDatetime(value) instanceof PyDateTime) return pyValue(m, value)
        if (m.k === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return pyValue(m, value)
        if (m.k === 'decimal' && typeof value === 'string') return pyValue(m, value)
        if (m.k === 'model' && isDict(value)) return pyValue(m, value)
        if ((m.k === 'list' || m.k === 'set') && Array.isArray(value)) return pyValue(m, value)
        if (m.k === 'dict' && isDict(value)) return pyValue(m, value)
        if (exact(m, value)) return value
      }
      return value
    }
    default:
      return value
  }
}

/** One stored field as Python holds it: `record.<name>`. */
export function attr(modelName: string, record: PyDict, name: string): Py {
  return pyValue(field(modelName, name).type, record[name] ?? null)
}

/** `record.model_dump(exclude_none=...)`, Python mode. */
export function modelDump(modelName: string, record: PyDict, options: { excludeNone?: boolean } = {}): PyDict {
  const out: PyDict = {}
  for (const f of model(modelName).fields) {
    const v = pyValue(f.type, record[f.name] ?? null)
    if (options.excludeNone && v === null) continue
    out[f.name] = v
  }
  return out
}

/** `record.model_dump(mode="json", exclude_none=...)`. */
export function modelDumpJson(modelName: string, record: PyDict, options: { excludeNone?: boolean } = {}): PyDict {
  const out: PyDict = {}
  for (const f of model(modelName).fields) {
    const v = record[f.name] ?? null
    if (options.excludeNone && v === null) continue
    out[f.name] = copy(v)
  }
  return out
}
