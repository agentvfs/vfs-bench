/**
 * Turn a benchmark's tool list into a Mirage CLI that mirrors it one to one.
 *
 * Tool `<server>__<tool>` becomes the command `<server> <tool>`: each tool
 * is a subcommand, a dotted name nests (`conversations.create` is
 * `conversations create`), underscores become dashes, and each parameter
 * in the tool's JSON schema becomes a flag of the same name. A call POSTs
 * `{tool, arguments}` to the fake's `/call`, the bridge's contract, unless
 * the CLI is given its own transport, and prints the result.
 *
 * Parameter types map to flags as:
 * - string, integer, number: a typed value, `choices` for an enum
 * - boolean: `--flag true|false`, or a bare `--flag` when the schema says
 *   `x-flag` (a CLI's own on/off switch)
 * - array of scalars: a repeatable flag
 * - anything else (objects, arrays of objects): one JSON value
 */
import {
  Argument,
  CLI,
  CLIHandler,
  CommandSpec,
  type CommandFnResult,
  type Context,
  FlagView,
  IOResult,
  z,
} from '@struktoai/mirage-node'
import type { NOOPAccessor } from '@struktoai/mirage-core/accessor/base'

export interface JsonSchema {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  default?: unknown
  /** OpenAPI 3.0's way to admit null. */
  nullable?: boolean
  /** A boolean given as a bare switch, `--flag`, as the source CLI takes it. */
  'x-flag'?: boolean
}

export interface Tool {
  /** The command path's source: `a.b_c` is `<cli> a b-c`. */
  name: string
  description?: string
  parameters?: JsonSchema
  /** The name sent to the fake, when it differs from `name`. */
  call?: string
}

const ConfigSchema = z.strictObject({ url: z.string() })
export type Config = z.infer<typeof ConfigSchema>

const encoder = new TextEncoder()

type Kind = 'str' | 'int' | 'float' | 'bool' | 'flag' | 'list' | 'json'

/** The schema with a nullable union reduced to its one non-null branch. */
function concrete(schema: JsonSchema): JsonSchema {
  const union = schema.anyOf ?? schema.oneOf
  if (union !== undefined) {
    const real = union.filter((s) => s.type !== 'null')
    if (real.length === 1) return { ...concrete(real[0]!), description: schema.description ?? real[0]!.description }
    return { ...schema, type: 'object' }
  }
  if (Array.isArray(schema.type)) {
    const real = schema.type.filter((t) => t !== 'null')
    return { ...schema, type: real.length === 1 ? real[0] : 'object' }
  }
  return schema
}

function kindOf(schema: JsonSchema): Kind {
  if (schema['x-flag'] === true) return 'flag'
  switch (schema.type) {
    case 'string':
      return 'str'
    case 'integer':
      return 'int'
    case 'number':
      return 'float'
    case 'boolean':
      return 'bool'
    case 'array': {
      const item = schema.items === undefined ? 'str' : kindOf(concrete(schema.items))
      return item === 'str' || item === 'int' || item === 'float' ? 'list' : 'json'
    }
    case undefined:
      return schema.enum !== undefined ? 'str' : 'json'
    default:
      return 'json'
  }
}

/** A JSON value's shape, compactly: `[{description: string, amount?: number}]`. */
function shape(raw: JsonSchema, depth = 0): string {
  const schema = concrete(raw)
  if (depth > 4) return 'any'
  if (schema.enum !== undefined) return schema.enum.map((v) => JSON.stringify(v)).join('|')
  switch (schema.type) {
    case 'array':
      return `[${schema.items === undefined ? 'any' : shape(schema.items, depth + 1)}]`
    case 'object':
    case undefined: {
      if (schema.properties === undefined) return schema.type === undefined ? 'any' : 'object'
      const need = new Set(schema.required ?? [])
      const fields = Object.entries(schema.properties).map(
        ([k, v]) => `${k}${need.has(k) ? '' : '?'}: ${shape(v, depth + 1)}`,
      )
      return `{${fields.join(', ')}}`
    }
    default:
      return String(schema.type)
  }
}

/** A tool name's command path: `a.b_c` is `['a', 'b-c']`. */
export function commandPath(name: string): string[] {
  return name.split('.').map((part) => part.replace(/_/g, '-'))
}

const flagOf = (param: string) => `--${param.replace(/_/g, '-')}`
const keyOf = (param: string) => param.replace(/-/g, '_')

interface Param {
  name: string
  kind: Kind
  item: Kind
}

/** Whether a schema admits null, which a flag expresses by being left out. */
function nullable(schema: JsonSchema): boolean {
  const union = schema.anyOf ?? schema.oneOf ?? []
  return (
    schema.nullable === true ||
    union.some((s) => s.type === 'null') ||
    (Array.isArray(schema.type) && schema.type.includes('null'))
  )
}

function argumentFor(name: string, raw: JsonSchema, listed: boolean): [Argument, Param] {
  const schema = concrete(raw)
  // Strict function schemas list every parameter as required, defaults and
  // nulls included; a flag is required only when it cannot be left out.
  const kind = kindOf(schema)
  const required = kind !== 'flag' && listed && raw.default === undefined && !nullable(raw)
  const item = kind === 'list' ? kindOf(concrete(schema.items ?? {})) : kind
  const help = [
    schema.description,
    kind === 'json' ? shape(schema) : '',
    schema.default !== undefined ? `default ${JSON.stringify(schema.default)}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  const init: ConstructorParameters<typeof Argument>[1] = { required, help: help === '' ? null : help }
  if (kind === 'int') init.type = 'int'
  else if (kind === 'float') init.type = 'float'
  else if (kind === 'bool') init.choices = ['true', 'false']
  else if (kind === 'flag') init.action = 'store_true'
  else if (kind === 'list') init.action = 'append'
  else if (kind === 'json') init.metavar = 'JSON'
  if (kind === 'str' && schema.enum !== undefined) init.choices = schema.enum.map(String)
  return [new Argument(flagOf(name), init), { name, kind, item }]
}

/** The tool's arguments, typed back from its flags. */
function argumentsFrom(params: Param[], ctx: Context): Record<string, unknown> {
  const flags = new FlagView(ctx.flags, ctx.spec)
  const out: Record<string, unknown> = {}
  for (const p of params) {
    const key = keyOf(p.name)
    if (!(key in (ctx.flags ?? {}))) continue
    if (p.kind === 'int') out[p.name] = flags.asInt(key)
    else if (p.kind === 'float') out[p.name] = flags.asFloat(key)
    else if (p.kind === 'bool') out[p.name] = flags.asStr(key) === 'true'
    else if (p.kind === 'flag') {
      if (flags.asBool(key)) out[p.name] = true
    }    else if (p.kind === 'list') {
      const values = flags.asList(key)
      out[p.name] = p.item === 'int' || p.item === 'float' ? values.map(Number) : values
    } else if (p.kind === 'json') {
      const text = flags.asStr(key) ?? ''
      try {
        out[p.name] = JSON.parse(text)
      } catch {
        throw new Error(`${flagOf(p.name)} takes JSON: ${text}`)
      }
    } else out[p.name] = flags.asStr(key)
  }
  return out
}

/** Print a tool's result: strings as they are, anything else as JSON. */
function render(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  return text.endsWith('\n') ? text : `${text}\n`
}

/** What a call returns: the tool's result, or why it failed. */
export interface Reply {
  ok: boolean
  result?: unknown
  error?: string
}

/** Carries one call to the fake. */
export type Send = (tool: Tool, args: Record<string, unknown>, config: Config) => Promise<Reply>

/** The bridge's contract: POST `{tool, arguments}` to `/call`. */
const bridgeCall: Send = async (tool, args, { url }) => {
  const reply = await fetch(`${url}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: tool.call ?? tool.name, arguments: args }),
  })
  const body = (await reply.json()) as Reply
  return reply.ok ? body : { ok: false, error: body.error ?? reply.statusText }
}

function handler(tool: Tool, params: Param[], send: Send): CLIHandler {
  return new CLIHandler({
    fn: async (accessor: NOOPAccessor, _paths, _texts, ctx: Context): Promise<CommandFnResult> => {
      let args: Record<string, unknown>
      try {
        args = argumentsFrom(params, ctx)
      } catch (error) {
        return [null, new IOResult({ exitCode: 2, stderr: encoder.encode(`${(error as Error).message}\n`) })]
      }
      const reply = await send(tool, args, accessor.config as Config)
      if (!reply.ok) return [null, new IOResult({ exitCode: 1, stderr: encoder.encode(render(reply.error ?? 'failed')) })]
      return [encoder.encode(render(reply.result)), new IOResult()]
    },
    write: true,
  })
}

/** A group's spec, built from the tool tree under it. */
interface Node {
  children: Map<string, Node>
  tool?: { spec: CommandSpec; path: string }
}

/**
 * A CLI named `name` with one subcommand per tool.
 *
 * Args:
 *   name: the command, the benchmark's server name with dashes.
 *   tools: the tools, as the benchmark lists them.
 *   description: what `<name> --help` says.
 *   send: carries a call to the fake; the bridge's `/call` by default.
 */
export function toolsCli(name: string, tools: Tool[], description?: string, send: Send = bridgeCall): CLI {
  const root: Node = { children: new Map() }
  const handlers: Record<string, CLIHandler> = {}
  for (const tool of tools) {
    const path = commandPath(tool.name)
    const props = tool.parameters?.properties ?? {}
    const required = new Set(tool.parameters?.required ?? [])
    const pairs = Object.entries(props).map(([param, schema]) => argumentFor(param, schema, required.has(param)))
    let node = root
    for (const part of path) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() })
      node = node.children.get(part)!
    }
    const leaf = path[path.length - 1]!
    node.tool = {
      spec: new CommandSpec({
        name: leaf,
        description: tool.description ?? null,
        arguments: pairs.map(([argument]) => argument),
      }),
      path: path.join(' '),
    }
    handlers[path.join(' ')] = handler(tool, pairs.map(([, param]) => param), send)
  }
  const build = (part: string, node: Node): CommandSpec => {
    if (node.children.size === 0) return node.tool!.spec
    if (node.tool !== undefined) throw new Error(`${name}: '${node.tool.path}' is both a tool and a group`)
    return new CommandSpec({ name: part, subcommands: [...node.children].map(([child, sub]) => build(child, sub)) })
  }
  return new CLI({
    spec: new CommandSpec({
      name,
      description: description ?? null,
      subcommands: [...root.children].map(([part, node]) => build(part, node)),
    }),
    handlers,
    configModel: ConfigSchema,
  })
}

/** `MathServer` is `math-server`, `OSINTServer` is `osint-server`. */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

/**
 * One CLI per server from a bridge fake's `/tools`, whose names are
 * `<server>.<tool>`: `<server> <tool>`, as an MCP client lists them.
 */
export async function serverClis(url: string): Promise<{ name: string; cli: CLI; config: { url: string } }[]> {
  const tools = (await (await fetch(`${url}/tools`)).json()) as Tool[]
  const servers = new Map<string, Tool[]>()
  for (const tool of tools) {
    const [server, ...rest] = tool.name.split('.')
    if (!servers.has(server!)) servers.set(server!, [])
    servers.get(server!)!.push({ ...tool, name: rest.join('.'), call: tool.name })
  }
  return [...servers].map(([server, list]) => ({
    name: kebab(server),
    cli: toolsCli(kebab(server), list, `${server}'s tools.`),
    config: { url },
  }))
}
