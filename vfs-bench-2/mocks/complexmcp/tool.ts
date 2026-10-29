/**
 * A ComplexMCP tool as fastmcp serves it: its parameters as the app's
 * function signature types them, which pydantic validates (in its lax
 * mode) before the handler runs, and its result as the text fastmcp sends
 * back, which upstream's client hands the model as it is.
 */
import { PyError, type Os } from './common.ts'
import { PyComplex, PyFloat, complexText, pyToJson, repr, toJson } from './py.ts'

/** A parameter's annotation in the app's signature. */
export type Param =
  | 'str'
  | 'int'
  | 'float'
  | 'bool'
  | 'list[str]'
  | 'list[float]'
  | 'list[str]|str'
  | 'str|None'
  // The plain servers': a `dict`, a bare `list` (of anything), `list[dict]`,
  // no annotation at all (`Any`), `bytes` (a str's UTF-8), and a `Literal`
  // of strs, which may also be None.
  | 'dict'
  | 'list'
  | 'list[dict]'
  | 'Any'
  | 'bytes'
  | Literal

/** `Literal['a', 'b']`, or with `none`, `Literal['a', 'b'] | None`. */
export interface Literal {
  literal: readonly string[]
  none?: boolean
}

/** `[name, annotation]`, or with a default: `[name, annotation, default]`. */
export type ParamSpec = [string, Param] | [string, Param, unknown]

export interface Tool<S> {
  params: ParamSpec[]
  run: (session: S, args: Record<string, any>) => Promise<unknown>
}

export type Tools<S> = Record<string, Tool<S>>

/** An app: its tools, how a run keeps its session, and what logout returns. */
export interface App<S, D> {
  name: string
  tools: Tools<S>
  load: (data: D, os: Os) => S
  save: (session: S) => D
  /** `get_session_dict()`, the environment upstream's judge reads. */
  sessionDict: (session: S) => unknown
}

export const ok = <T>(output: T) => ({ status: 'ok', output })
export const failed = <T>(output: T) => ({ status: 'failed', output })

/** What upstream's client shows the model when the call itself fails: the dict it builds, as Python prints it. */
export const clientError = (status: string, output: string): string => repr({ status, output })

const PYDANTIC = 'https://errors.pydantic.dev/2.12/v'

function typeName(v: unknown): string {
  if (v === null) return 'NoneType'
  if (typeof v === 'string') return 'str'
  if (typeof v === 'boolean') return 'bool'
  if (v instanceof PyFloat) return 'float'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'
  if (Array.isArray(v)) return 'list'
  return 'dict'
}

/** pydantic's literal_error message: `Input should be 'a', 'b' or 'c'`. */
function literalMessage(choices: readonly string[]): string {
  const quoted = choices.map((c) => `'${c}'`)
  const head = quoted.slice(0, -1).join(', ')
  return `Input should be ${quoted.length > 1 ? `${head} or ${quoted.at(-1)}` : quoted[0]}`
}

const isDict = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyFloat)

interface Problem {
  loc: string
  msg: string
  type: string
  input: unknown
}

/** One argument as pydantic's lax mode takes it, or why not. */
function coerce(name: string, param: Param, v: unknown): { value: unknown } | Problem {
  const bad = (msg: string, type: string): Problem => ({ loc: name, msg, type, input: v })
  if (typeof param === 'object') {
    if (param.none && v === null) return { value: null }
    return typeof v === 'string' && param.literal.includes(v) ? { value: v } : bad(literalMessage(param.literal), 'literal_error')
  }
  switch (param) {
    case 'str':
      return typeof v === 'string' ? { value: v } : bad('Input should be a valid string', 'string_type')
    case 'str|None':
      return v === null || typeof v === 'string' ? { value: v } : bad('Input should be a valid string', 'string_type')
    case 'bool':
      if (typeof v === 'boolean') return { value: v }
      return bad('Input should be a valid boolean', 'bool_type')
    case 'int': {
      if (typeof v === 'boolean') return { value: v ? 1 : 0 }
      if (typeof v === 'number' || v instanceof PyFloat) {
        const n = Number(v)
        return Number.isInteger(n) ? { value: n } : bad('Input should be a valid integer, got a number with a fractional part', 'int_from_float')
      }
      if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return { value: Number(v.trim()) }
      if (typeof v === 'string') return bad('Input should be a valid integer, unable to parse string as an integer', 'int_parsing')
      return bad('Input should be a valid integer', 'int_type')
    }
    case 'float': {
      if (typeof v === 'boolean') return { value: new PyFloat(v ? 1 : 0) }
      if (typeof v === 'number' || v instanceof PyFloat) return { value: new PyFloat(Number(v)) }
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return { value: new PyFloat(Number(v)) }
      if (typeof v === 'string') return bad('Input should be a valid number, unable to parse string as a number', 'float_parsing')
      return bad('Input should be a valid number', 'float_type')
    }
    case 'list[str]':
    case 'list[float]': {
      if (!Array.isArray(v)) return bad('Input should be a valid list', 'list_type')
      const out: unknown[] = []
      for (const [i, item] of v.entries()) {
        const c = coerce(`${name}.${i}`, param === 'list[str]' ? 'str' : 'float', item)
        if ('loc' in c) return c
        out.push(c.value)
      }
      return { value: out }
    }
    case 'list[str]|str':
      if (typeof v === 'string') return { value: v }
      return coerce(name, 'list[str]', v)
    case 'dict':
      return isDict(v) ? { value: v } : bad('Input should be a valid dictionary', 'dict_type')
    case 'list':
      return Array.isArray(v) ? { value: v } : bad('Input should be a valid list', 'list_type')
    case 'list[dict]': {
      if (!Array.isArray(v)) return bad('Input should be a valid list', 'list_type')
      for (const [i, item] of v.entries()) {
        if (!isDict(item)) return { loc: `${name}.${i}`, msg: 'Input should be a valid dictionary', type: 'dict_type', input: item }
      }
      return { value: v }
    }
    case 'Any':
      return { value: v }
    case 'bytes':
      return typeof v === 'string' ? { value: Buffer.from(v, 'utf8') } : bad('Input should be a valid bytes', 'bytes_type')
  }
}

/** pydantic's ValidationError, as str() prints it. */
/** pydantic's `input_value`: past 50 bytes, its first 25 and last 24, at character bounds. */
function truncated(text: string): string {
  const bytes = Buffer.from(text)
  if (bytes.length <= 50) return text
  const continuation = (i: number) => (bytes[i]! & 0xc0) === 0x80
  let head = 25
  while (head > 0 && continuation(head)) head--
  let tail = bytes.length - 24
  while (tail < bytes.length && continuation(tail)) tail++
  return `${bytes.subarray(0, head).toString()}...${bytes.subarray(tail).toString()}`
}

function validationError(tool: string, problems: Problem[]): string {
  const lines = [`${problems.length} validation error${problems.length === 1 ? '' : 's'} for call[${tool}]`]
  for (const p of problems) {
    lines.push(p.loc)
    lines.push(`  ${p.msg} [type=${p.type}, input_value=${truncated(repr(p.input))}, input_type=${typeName(p.input)}]`)
    lines.push(`    For further information visit ${PYDANTIC}/${p.type}`)
  }
  return lines.join('\n')
}

/** The arguments as the handler gets them, or the error text fastmcp sends for them. */
export function validate(tool: string, spec: ParamSpec[], args: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> | string {
  const out: Record<string, unknown> = {}
  const problems: Problem[] = []
  for (const [name, param, ...dflt] of spec) {
    if (!(name in args)) {
      if (dflt.length > 0) out[name] = dflt[0]
      // A CLI's repeatable flag given no value: a list of scalars cannot
      // be sent empty any other way (complexmcp.py's `parameters`).
      else if (param === 'list[str]' || param === 'list[float]') out[name] = []
      else problems.push({ loc: name, msg: 'Missing required argument', type: 'missing_argument', input: { ...args, ...extra } })
      continue
    }
    const c = coerce(name, param, args[name])
    if ('loc' in c) problems.push(c)
    else out[name] = c.value
  }
  for (const name of Object.keys(args)) {
    if (!spec.some(([n]) => n === name)) problems.push({ loc: name, msg: 'Unexpected keyword argument', type: 'unexpected_keyword_argument', input: args[name] })
  }
  return problems.length > 0 ? validationError(tool, problems) : out
}

/**
 * Call a tool and give back the text upstream's client hands the model: the
 * result as fastmcp serializes it (a string as it is), or, where fastmcp
 * answers an error, the dict the client makes of it.
 */
export async function call<S>(tools: Tools<S>, name: string, session: S, args: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<string> {
  const tool = tools[name]!
  const valid = validate(name, tool.params, args, extra)
  if (typeof valid === 'string') return clientError('error', valid)
  let result: unknown
  try {
    result = await tool.run(session, valid)
  } catch (error) {
    if (error instanceof PyError) return clientError('error', `Error calling tool '${name}': ${error.message}`)
    throw error
  }
  // A tool that returns None has no content, which the client indexes.
  if (result === null || result === undefined) return clientError('error', 'list index out of range')
  return typeof result === 'string' ? result : toJson(result)
}

/**
 * A tool's return annotation, as the output schema fastmcp derives from it:
 * `-> float` is `number`, `-> list[str]` is `list[str]`, `-> dict` is
 * `dict`, an unannotated tool `none` (no schema at all).
 */
export type Returns =
  | 'number'
  | 'integer'
  | 'boolean'
  | 'string'
  | 'bytes'
  | 'any'
  | 'dict'
  | 'none'
  | 'list'
  | 'list[str]'
  | 'list[float]'
  | 'list[list]'
  | 'list[list[int]]'

const ITEM: Partial<Record<Returns, Returns>> = { 'list[str]': 'string', 'list[float]': 'number', 'list[list]': 'list', 'list[list[int]]': 'list[int]' as Returns }

/** Whether a value is of a JSON schema type, as jsonschema checks a Python value. */
function ofType(v: unknown, type: string): boolean {
  switch (type) {
    case 'number':
      return (typeof v === 'number' || typeof v === 'bigint' || v instanceof PyFloat) && v !== null
    case 'integer':
      return typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v)) || (v instanceof PyFloat && Number.isInteger(v.v))
    case 'boolean':
      return typeof v === 'boolean'
    case 'string':
      return typeof v === 'string'
    case 'array':
      return Array.isArray(v)
    default:
      return true
  }
}

const SCHEMA_TYPE: Partial<Record<string, string>> = {
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  string: 'string',
  bytes: 'string',
  list: 'array',
  'list[int]': 'array',
}

/** A value of a wrapped result that is not of its schema's type: its path (item indexes), and [path text, schema path, schema text, value]. */
type Mismatch = [number[], [string, string, string, unknown]]

/**
 * Every value of a wrapped result that is not of its schema's type, as
 * jsonschema's `iter_errors` finds them.
 */
function mismatches(returns: Returns | string, v: unknown, at: number[], schemaPath: string): Mismatch[] {
  const item = ITEM[returns as Returns] ?? (returns === 'list[int]' ? 'integer' : undefined)
  const type = item !== undefined || returns.startsWith('list') ? 'array' : SCHEMA_TYPE[returns]
  if (type === undefined) return []
  const path = `['result']${at.map((i) => `[${i}]`).join('')}`
  if (!ofType(v, type)) return [[at, [path, schemaPath, schemaText(returns), v]]]
  if (item === undefined || !Array.isArray(v)) return []
  return v.flatMap((x, i) => mismatches(item, x, [...at, i], `${schemaPath}['items']`))
}

/**
 * The one error jsonschema's `best_match` reports: the shallowest, and of
 * those the one with the greatest path (the last item), by its `relevance`.
 */
function mismatch(returns: Returns, v: unknown): [string, string, string, unknown] | null {
  const all = mismatches(returns, v, [], "['properties']['result']")
  if (all.length === 0) return null
  const later = (a: number[], b: number[]) => {
    if (a.length !== b.length) return a.length < b.length
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
    return false
  }
  let best = all[0]!
  for (const m of all.slice(1)) if (later(m[0], best[0])) best = m
  return best[1]
}

/** A schema as jsonschema's error prints it (Python's repr of the dict). */
function schemaText(returns: string): string {
  const t = (r: string): string => {
    if (r === 'list[str]') return "{'items': {'type': 'string'}, 'type': 'array'}"
    if (r === 'list[float]') return "{'items': {'type': 'number'}, 'type': 'array'}"
    if (r === 'list[int]') return "{'items': {'type': 'integer'}, 'type': 'array'}"
    if (r === 'list[list[int]]') return "{'items': {'items': {'type': 'integer'}, 'type': 'array'}, 'type': 'array'}"
    if (r === 'list') return "{'items': {}, 'type': 'array'}"
    if (r === 'list[list]') return "{'items': {'items': {}, 'type': 'array'}, 'type': 'array'}"
    if (r === 'bytes') return "{'format': 'binary', 'type': 'string'}"
    return `{'type': '${SCHEMA_TYPE[r] ?? r}'}`
  }
  return t(returns)
}

/** `pydantic_core.to_jsonable_python`: a complex is its text, bytes their UTF-8. */
function jsonable(v: unknown): unknown {
  if (v instanceof PyComplex) return complexText(v)
  if (Buffer.isBuffer(v)) return v.toString('utf8')
  if (Array.isArray(v)) return v.map(jsonable)
  return v
}

/** A value as the wire carries structured content: a float that is not finite is null. */
function overWire(v: unknown): unknown {
  if (v instanceof PyFloat) return Number.isFinite(v.v) ? v : null
  if (typeof v === 'number' && !Number.isFinite(v)) return null
  if (Array.isArray(v)) return v.map(overWire)
  return v
}

/**
 * The text upstream's client hands the model for a plain server's result,
 * given its tool's return annotation: what `call` makes of a result, plus
 * what fastmcp and the MCP client check of it. The content is the result
 * as `pyToJson` writes it, and an empty list is no content at all (the
 * client's index fails). The server checks the structured result (`{"result":
 * ...}`) against the output schema first, the client again after the wire
 * has made a float that is not finite null. Returns null for None, which
 * `call` answers as the client does.
 */
export function returned(tool: string, returns: Returns, value: unknown): string | null {
  if (value === null || value === undefined) return null
  const content = typeof value === 'string' ? value : Array.isArray(value) && value.length === 0 ? null : pyToJson(value)
  if (returns !== 'none' && returns !== 'dict' && returns !== 'any') {
    const structured = jsonable(value)
    const bad = mismatch(returns, structured)
    if (bad) return clientError('error', `Output validation error: ${repr(bad[3])} is not of type '${schemaType(bad[2])}'`)
    const wire = mismatch(returns, overWire(structured))
    if (wire) {
      const [path, schemaPath, schema, v] = wire
      return clientError(
        'error',
        `Invalid structured content returned by tool ${tool}: ${repr(v)} is not of type '${schemaType(schema)}'\n\n` +
          `Failed validating 'type' in schema${schemaPath}:\n    ${schema}\n\nOn instance${path}:\n    ${repr(v)}`,
      )
    }
  }
  if (content === null) return clientError('error', 'list index out of range')
  return content
}

const schemaType = (schema: string): string => /'type': '(\w+)'}$/.exec(schema)![1]!

/** A plain server's tool: its parameters, its return annotation and its handler. */
export type PlainTool = [params: ParamSpec[], returns: Returns, run: (args: Record<string, any>) => unknown]

/** A plain server's tools (they keep no session), each answering through `returned`. */
export function plainTools(defs: Record<string, PlainTool>): Tools<null> {
  return Object.fromEntries(
    Object.entries(defs).map(([name, [params, returns, run]]) => [name, { params, run: async (_session: null, args: Record<string, any>) => returned(name, returns, await run(args)) }]),
  )
}
