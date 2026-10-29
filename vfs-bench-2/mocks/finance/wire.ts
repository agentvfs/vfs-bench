/**
 * What upstream's finance mock answers, byte for byte where a caller can
 * see it: its JSON shapes, mock-lib's envelopes, Hono's defaults, and the
 * messages of the zod schemas its routes validate with.
 *
 * Upstream validates through @hono/zod-openapi with zod 3 and answers a
 * failure with mock-lib's hook: `{"success": false, "message": "<path>:
 * <message>; ..."}`, each zod issue in schema order. `Schema` below is the
 * part of zod those schemas use, with zod's own wording.
 */
import type { JsonValue, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'

export function json(status: number, body: JsonValue): Reply {
  return { status, body }
}

/** mock-lib's `err()`: what its hooks, auth and error handler answer. */
export function failure(status: number, message: string): Reply {
  return { status, body: { success: false, message } }
}

/** Hono's `onError` in mock-lib, for a handler that throws. */
export const INTERNAL = (): Reply => failure(500, 'Internal server error')

/** mock-lib's `onError` for a body that is not JSON. */
export const INVALID_JSON = (): Reply => failure(400, 'Invalid JSON body')

const TEXT = 'text/plain; charset=UTF-8'
const HTML = 'text/html; charset=UTF-8'

/** Hono's own 404, for a path no route answers. */
export function notFound(): Reply {
  return { status: 404, body: Buffer.from('404 Not Found'), headers: { 'Content-Type': TEXT } }
}

export function html(text: string): Reply {
  return { status: 200, body: Buffer.from(text), headers: { 'Content-Type': HTML } }
}

/** Hono's `c.redirect`, a 302. */
export function redirect(location: string, headers: Record<string, string | string[]> = {}): Reply {
  return { status: 302, headers: { ...headers, Location: location } }
}

export function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'status' in value && !Array.isArray(value)
}

/** The largest id Prisma binds to an `Int`. */
const INT_MAX = 2 ** 31 - 1

/**
 * The id to look a row up by. Upstream's SQLite matches an id no row can
 * have (`1.5`, `NaN`, past 2^31) to nothing; Prisma refuses to bind one to
 * an `Int`. Such an id is asked for as -1, which no row has.
 */
export function rowId(value: number): number {
  return Number.isInteger(value) && Math.abs(value) <= INT_MAX ? value : -1
}

// --- zod ---

export interface Issue {
  path: (string | number)[]
  message: string
}

/** A schema: parses a value at a path, adding zod's issues, and returns the parsed value. */
export type Schema = (value: unknown, path: (string | number)[], issues: Issue[]) => unknown

/** zod's name for a value's type, as its messages say it. */
function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  if (typeof value === 'number' && Number.isNaN(value)) return 'nan'
  return typeof value
}

function invalidType(expected: string, value: unknown, path: (string | number)[], issues: Issue[]): undefined {
  const received = typeOf(value)
  issues.push({ path, message: received === 'undefined' ? 'Required' : `Expected ${expected}, received ${received}` })
  return undefined
}

export const z = {
  string:
    (checks: { regex?: RegExp; max?: number } = {}): Schema =>
    (value, path, issues) => {
      if (typeof value !== 'string') return invalidType('string', value, path, issues)
      if (checks.regex !== undefined && !checks.regex.test(value)) issues.push({ path, message: 'Invalid' })
      if (checks.max !== undefined && value.length > checks.max) {
        issues.push({ path, message: `String must contain at most ${checks.max} character(s)` })
      }
      return value
    },
  number:
    (checks: { positive?: boolean; coerce?: boolean } = {}): Schema =>
    (raw, path, issues) => {
      const value = checks.coerce === true ? Number(raw) : raw
      if (typeof value !== 'number' || Number.isNaN(value)) return invalidType('number', value, path, issues)
      if (checks.positive === true && !(value > 0)) issues.push({ path, message: 'Number must be greater than 0' })
      return value
    },
  enum:
    (values: readonly string[]): Schema =>
    (value, path, issues) => {
      const expected = values.map((v) => `'${v}'`).join(' | ')
      if (typeof value !== 'string') return invalidType(expected, value, path, issues)
      if (!values.includes(value)) issues.push({ path, message: `Invalid enum value. Expected ${expected}, received '${value}'` })
      return value
    },
  array:
    (item: Schema): Schema =>
    (value, path, issues) => {
      if (!Array.isArray(value)) return invalidType('array', value, path, issues)
      return value.map((v, i) => item(v, [...path, i], issues))
    },
  object:
    (shape: Record<string, Schema>): Schema =>
    (value, path, issues) => {
      if (typeOf(value) !== 'object') return invalidType('object', value, path, issues)
      const record = value as Record<string, unknown>
      return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, field(record[key], [...path, key], issues)]))
    },
  optional:
    (inner: Schema): Schema =>
    (value, path, issues) =>
      value === undefined ? undefined : inner(value, path, issues),
  default:
    (inner: Schema, fallback: unknown): Schema =>
    (value, path, issues) =>
      value === undefined ? fallback : inner(value, path, issues),
}

/** A value's issues against a schema. */
export function check(schema: Schema, value: unknown): Issue[] {
  const issues: Issue[] = []
  schema(value, [], issues)
  return issues
}

/** mock-lib's validation hook: every issue, as `<path>: <message>`, in one 400. */
export function invalid(issues: Issue[]): Reply {
  return failure(400, issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
}

/** zod's `error.format()`. */
export function formatted(issues: Issue[]): JsonValue {
  const out: Record<string, JsonValue> = { _errors: [] }
  for (const issue of issues) {
    let node = out
    if (issue.path.length === 0) (node._errors as JsonValue[]).push(issue.message)
    issue.path.forEach((key, i) => {
      const child = (node[String(key)] ??= { _errors: [] }) as Record<string, JsonValue>
      if (i === issue.path.length - 1) (child._errors as JsonValue[]).push(issue.message)
      node = child
    })
  }
  return out
}

// --- request bodies, as Hono reads them ---

/** Hono's `jsonRegex`: a type whose body its json validator parses. */
const JSON_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/

/** A JSON body, or undefined where Hono's `c.req.json()` throws. */
export function jsonBody(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/** The type check mock-lib puts before a JSON body schema: anything but `application/json` is a 415. */
export function jsonType(contentType: string | undefined): Reply | null {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json'
    ? null
    : failure(415, 'Content-Type must be application/json')
}

/**
 * @hono/zod-openapi's json validator, for a body it does not require: only a
 * body of a JSON type is read, a 400 if it is not JSON, and validated; one
 * of a JSON type Hono's validator does not parse is validated as `{}`.
 */
export function jsonValid(contentType: string | undefined, raw: Buffer, schema: Schema): Reply | null {
  const ct = contentType ?? ''
  if (!/^application\/([a-z-.]+\+)?json/.test(ct)) return null
  let value: unknown = {}
  if (JSON_TYPE.test(ct)) {
    value = jsonBody(raw)
    if (value === undefined) return INVALID_JSON()
  }
  const issues = check(schema, value)
  return issues.length > 0 ? invalid(issues) : null
}

/** Hono's `c.req.parseBody()`: a form's fields, the last of each name, or `{}` for any other body. */
export async function formBody(contentType: string | undefined, raw: Buffer): Promise<Record<string, unknown>> {
  const ct = contentType ?? ''
  if (!ct.startsWith('multipart/form-data') && !ct.startsWith('application/x-www-form-urlencoded')) return {}
  const form = await new Request('http://finance/', {
    method: 'POST',
    headers: { 'content-type': ct },
    body: new Blob([new Uint8Array(raw)]),
  }).formData()
  const out: Record<string, unknown> = {}
  form.forEach((value, key) => {
    if (!key.endsWith('[]')) out[key] = value
    else ((out[key] ??= []) as unknown[]).push(value)
  })
  return out
}

/** Upstream's `parseFormBody`: a form's `amount` as a number, where it is one. */
export function parseFormBody(form: Record<string, unknown>): Record<string, unknown> {
  const body = { ...form }
  if (typeof body.amount === 'string') {
    const num = Number(body.amount)
    body.amount = Number.isNaN(num) ? body.amount : num
  }
  return body
}

/** Upstream's `round2`. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** SQLite's `datetime('now')`, as the run's clock reads it. */
export function sqliteNow(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ')
}
