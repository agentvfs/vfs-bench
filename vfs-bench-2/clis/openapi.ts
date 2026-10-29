/**
 * Turn a web app's OpenAPI document into a Mirage CLI, one command per
 * operation.
 *
 * For benchmarks whose services are web apps: an operation's command is its
 * summary in kebab case (`Create invoice` is `create-invoice`), and its
 * path, query and JSON body parameters are its flags, typed as tools.ts
 * types a tool's. A call sends the request and prints the response body.
 * A required header whose schema allows one value, such as a version
 * header, is sent with that value and is not a flag.
 * An operation whose spec describes no body but whose method takes one
 * gets `--body JSON`; one whose body is only multipart is left out.
 *
 * The CLI keeps a session as the app's own frontend does: a cookie the
 * server sets, or an `access_token` a response returns, goes with every
 * later request, so logging in once is enough.
 */
import type { CLI } from '@struktoai/mirage-node'

import { type Config, type JsonSchema, type Reply, type Send, type Tool, toolsCli } from './tools.ts'

interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: JsonSchema
  /** For an array in the query: `false` sends `a,b`, not `x=a&x=b`. */
  explode?: boolean
}

interface Operation {
  summary?: string
  description?: string
  operationId?: string
  parameters?: (Parameter | { $ref: string })[]
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> }
}

export interface OpenApi {
  paths: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, JsonSchema>; parameters?: Record<string, Parameter> }
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
const BODIED = new Set(['post', 'put', 'patch'])

/** Where each of an operation's arguments goes in the request. */
interface Route {
  method: string
  path: string
  pathParams: string[]
  queryParams: string[]
  /** Query arrays sent comma-joined. */
  joined: Set<string>
  /** JSON body properties; `null` when the whole body is `--body`. */
  bodyParams: string[] | null
  hasBody: boolean
  /** Required headers whose one allowed value is sent with every call. */
  headers: Record<string, string>
}

/** The one value a schema allows, for an enum of one or a `const`. */
function onlyValue(schema: JsonSchema): string | undefined {
  const fixed = schema as JsonSchema & { const?: unknown }
  if (fixed.const !== undefined) return String(fixed.const)
  if (fixed.enum?.length === 1) return String(fixed.enum[0])
  return undefined
}

/** A schema with every local `$ref` replaced by what it points to, and `allOf` merged. */
function deref(schema: JsonSchema | undefined, spec: OpenApi, depth = 0): JsonSchema {
  if (schema === undefined || depth > 8) return {}
  const ref = (schema as { $ref?: string }).$ref
  if (ref !== undefined) {
    const target = spec.components?.schemas?.[ref.replace('#/components/schemas/', '')]
    return target === undefined ? {} : deref(target, spec, depth + 1)
  }
  const allOf = (schema as { allOf?: JsonSchema[] }).allOf
  if (allOf !== undefined) {
    const { allOf: _, ...rest } = schema as JsonSchema & { allOf?: JsonSchema[] }
    const parts = [...allOf.map((s) => deref(s, spec, depth + 1)), deref(rest, spec, depth + 1)]
    const merged: JsonSchema = Object.assign({}, ...parts)
    const properties = Object.assign({}, ...parts.map((p) => p.properties ?? {}))
    const required = parts.flatMap((p) => p.required ?? [])
    if (Object.keys(properties).length > 0) merged.properties = properties
    if (required.length > 0) merged.required = [...new Set(required)]
    return merged
  }
  const out: JsonSchema = { ...schema }
  if (schema.properties !== undefined) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, deref(v, spec, depth + 1)]))
  }
  if (schema.items !== undefined) out.items = deref(schema.items, spec, depth + 1)
  if (schema.anyOf !== undefined) out.anyOf = schema.anyOf.map((s) => deref(s, spec, depth + 1))
  if (schema.oneOf !== undefined) out.oneOf = schema.oneOf.map((s) => deref(s, spec, depth + 1))
  return out
}

const kebab = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** The tool for one operation, and where its arguments go. */
function toolFor(method: string, path: string, op: Operation, spec: OpenApi): [Tool, Route] | null {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const add = (name: string, schema: JsonSchema, need: boolean) => {
    if (name in properties) throw new Error(`${method.toUpperCase()} ${path}: '${name}' is two parameters`)
    properties[name] = schema
    if (need) required.push(name)
  }
  const params = (op.parameters ?? []).flatMap((p) => {
    if (!('$ref' in p)) return [p]
    const target = spec.components?.parameters?.[p.$ref.replace('#/components/parameters/', '')]
    return target === undefined ? [] : [target]
  })
  for (const p of params.filter((p) => p.in === 'path' || p.in === 'query')) {
    let schema: JsonSchema = { ...deref(p.schema, spec), description: p.description ?? p.schema?.description }
    // A path parameter is always given, whatever its schema says about null.
    if (p.in === 'path' && Array.isArray(schema.type)) schema = { ...schema, type: schema.type.filter((t) => t !== 'null') }
    add(p.name, schema, p.in === 'path' || p.required === true)
  }
  const content = op.requestBody?.content
  const json = content?.['application/json']?.schema
  let bodyParams: string[] | null = []
  let hasBody = false
  if (json !== undefined) {
    const body = deref(json, spec)
    const need = new Set(body.required ?? [])
    for (const [name, schema] of Object.entries(body.properties ?? {})) add(name, schema, need.has(name))
    bodyParams = Object.keys(body.properties ?? {})
    hasBody = true
  } else if (content !== undefined && Object.keys(content).length > 0) {
    return null
  } else if (BODIED.has(method)) {
    add('body', { description: 'the request body, as JSON' }, false)
    bodyParams = null
    hasBody = true
  }
  const name = kebab(op.summary ?? op.operationId ?? `${method} ${path}`)
  // The summary and the description's first paragraph; some specs' run to pages.
  const description = [op.summary, op.description?.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ')]
    .filter(Boolean)
    .join('. ')
  const route: Route = {
    method: method.toUpperCase(),
    path,
    pathParams: params.filter((p) => p.in === 'path').map((p) => p.name),
    queryParams: params.filter((p) => p.in === 'query').map((p) => p.name),
    joined: new Set(params.filter((p) => p.in === 'query' && p.explode === false).map((p) => p.name)),
    bodyParams,
    hasBody,
    headers: {},
  }
  for (const p of params.filter((p) => p.in === 'header' && p.required === true)) {
    const value = onlyValue(deref(p.schema, spec))
    if (value !== undefined) route.headers[p.name] = value
  }
  return [{ name, description, parameters: { type: 'object', properties, required }, call: `${route.method} ${path}` }, route]
}

/** One CLI's session: the cookies and the bearer token it has been given. */
class Session {
  readonly cookies = new Map<string, string>()
  token: string | null = null

  headers(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (this.token !== null) headers.authorization = `Bearer ${this.token}`
    return headers
  }

  absorb(response: Response, body: unknown): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';')
      const at = pair!.indexOf('=')
      const name = pair!.slice(0, at).trim()
      const value = pair!.slice(at + 1).trim()
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))
      if (expired || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    const token = accessToken(body)
    if (token !== null) this.token = token
  }
}

/** An `access_token` at the top of a JSON body or one level down. */
function accessToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.access_token === 'string') return record.access_token
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).access_token === 'string') {
      return (value as Record<string, string>).access_token!
    }
  }
  return null
}

function transport(routes: Map<string, Route>, session: Session): Send {
  return async (tool, args, { url }: Config): Promise<Reply> => {
    const route = routes.get(tool.call!)!
    let path = route.path
    for (const name of route.pathParams) path = path.replace(`{${name}}`, encodeURIComponent(String(args[name])))
    const query = new URLSearchParams()
    for (const name of route.queryParams) {
      const value = args[name]
      if (value === undefined) continue
      if (Array.isArray(value) && route.joined.has(name)) query.append(name, value.join(','))
      else for (const v of Array.isArray(value) ? value : [value]) query.append(name, String(v))
    }
    const headers: Record<string, string> = { ...route.headers, ...session.headers() }
    let body: string | undefined
    if (route.hasBody) {
      const payload =
        route.bodyParams === null
          ? args.body
          : Object.fromEntries(route.bodyParams.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]))
      if (payload !== undefined) {
        body = JSON.stringify(payload)
        headers['content-type'] = 'application/json'
      }
    }
    const target = `${url}${path}${query.size > 0 ? `?${query}` : ''}`
    const response = await fetch(target, { method: route.method, headers, body })
    const text = await response.text()
    let parsed: unknown = text
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      try {
        parsed = JSON.parse(text)
      } catch {
        // Not JSON after all; print it as text.
      }
    }
    session.absorb(response, parsed)
    if (response.status >= 400) {
      return { ok: false, error: `HTTP ${response.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}` }
    }
    return { ok: true, result: parsed }
  }
}

/**
 * A CLI named `name` with one command per operation of `spec`.
 *
 * Args:
 *   name: the command.
 *   spec: the app's OpenAPI document.
 *   description: what `<name> --help` says.
 *   include: which paths to keep; all of them by default.
 */
export function openapiCli(name: string, spec: OpenApi, description: string, include: (path: string) => boolean = () => true): CLI {
  const tools: Tool[] = []
  const routes = new Map<string, Route>()
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!include(path)) continue
    for (const method of METHODS) {
      const op = item[method]
      if (op === undefined) continue
      const built = toolFor(method, path, op, spec)
      if (built === null) continue
      const [tool, route] = built
      if (tools.some((t) => t.name === tool.name)) throw new Error(`${name}: two operations are '${tool.name}'`)
      tools.push(tool)
      routes.set(tool.call!, route)
    }
  }
  return toolsCli(name, tools, description, transport(routes, new Session()))
}
