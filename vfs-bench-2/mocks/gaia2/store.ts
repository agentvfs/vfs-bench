/**
 * What every Gaia2 app's fake shares: its store, its event log, its ids, its
 * clock and its kit wiring.
 *
 * Upstream is gaia2-cli (meta-agents-research-environments @ a9fd2ed, MIT,
 * gaia2-cli/cli/gaia2_cli/apps/<app>.py): one click program per app, each
 * command a process that loads the app's state file, works on it as Python
 * dicts, saves it, appends its call to `events.jsonl` (`log_action`) and
 * prints its result as `json.dumps(..., indent=2)` (`json_output`), or an
 * error on stderr with exit 1 (`cli_error`). Here each command is a route,
 * `POST /<cli>/<command>`, whose JSON body is the command's options by their
 * Python names, as the CLIs of `harbor/tools.ts` send them; a handler is
 * upstream's command, statement for statement, over the run's state (the
 * `state` doc, read whole and written back whole). The reply is the text
 * upstream prints: a JSON string, status 200 for stdout and 400 for stderr.
 *
 * Upstream runs each command under libfaketime frozen at the scenario's
 * start (the runner's `FAKETIME`), so `time.time()` is the run's epoch for
 * every call; the kit clock is never ticked. `uuid.uuid4()` is a counter of
 * the run's, hashed, so a run's ids are the same each time
 * (`sha256("<service>:<n>")`, version 4 bits set).
 */
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

import { parseConfig, route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, Dmmf, Fake, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { PyFloat, dumps, loads } from './pyjson.ts'
import type { Py, PyDict } from './pyjson.ts'

export { PyFloat, copy, dumps, floatRepr, isFloat, isNumber, loads, num, pf, quote } from './pyjson.ts'
export type { Py, PyDict } from './pyjson.ts'

/** The part of an app's Prisma client the store uses: every app's is the same schema. */
export interface Db {
  doc: {
    findUnique(args: { where: { name: string } }): Promise<{ name: string; doc: string } | null>
    upsert(args: { where: { name: string }; create: { name: string; doc: string }; update: { doc: string } }): Promise<unknown>
  }
  event: {
    create(args: { data: { wall: number; entry: string } }): Promise<unknown>
  }
  $disconnect(): Promise<void>
}

/** `cli_error(msg)`: the message on stderr, exit 1. */
export class CliError extends Error {}

/**
 * An exception upstream leaves uncaught: Python prints its traceback and
 * exits 1. Here stderr is its last line, `<type>: <message>`.
 */
export class PyError extends Error {
  readonly type: string
  constructor(type: string, message: string) {
    super(message)
    this.type = type
  }
}

/** Python's `ValueError(msg)`, which handlers raise and catch as upstream's do. */
export const valueError = (message: string) => new PyError('ValueError', message)
/** Python's bare `Exception(msg)`. */
export const exception = (message: string) => new PyError('Exception', message)

/** `str(e)` for an exception a handler catches, as Python prints it. */
export function str(error: unknown): string {
  if (error instanceof PyError || error instanceof CliError) return error.message
  throw error
}

/**
 * A click usage error (`click.BadParameter`, a bad option value): click
 * prints the usage line and the error, and exits 2.
 */
export class UsageError extends Error {}

/** One command's call: its options, the run's state and clock, and its log. */
export interface Call {
  /** The options as sent, by their Python names. */
  readonly args: Record<string, unknown>
  /** A string option, or its default. */
  str(name: string, fallback?: string | null): string | null
  /** An int option (click's INT), or its default. */
  int(name: string, fallback?: number | null): number | null
  /** A float option (click's FLOAT): a Python float, or its default. */
  float(name: string, fallback?: number | null): number | PyFloat | null
  /** A switch (`is_flag`). */
  flag(name: string): boolean
  /** A repeatable option (`multiple=True`), as a list. */
  list(name: string): string[]
  /** `time.time()`: the run's epoch, frozen. */
  now(): PyFloat
  /** `uuid.uuid4().hex`. */
  uuidHex(): string
  /** `str(uuid.uuid4())`. */
  uuidStr(): string
  /** `load_app_state(APP_NAME)`: `{}` where the app has no state. */
  state(): Promise<PyDict>
  /** `save_app_state(APP_NAME, state)`. */
  save(state: PyDict): Promise<void>
  /** `log_action(fn, args, ret, write)`. */
  log(fn: string, args: PyDict, ret?: Py, write?: boolean): Promise<void>
  /** The run's cloud drive on the host, if the trial gave it one (`sandboxPath`). */
  drive(): string | null
}

/** A command's printed text, where it prints more than `json_output`. */
export class Printed {
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
}

/** One of upstream's commands: its CLI name and handler, which returns what `json_output` prints. */
export interface Command {
  name: string
  run(call: Call): Promise<Py | Printed>
}

/** `json_output(data)`: what it prints, with print's newline. */
export function jsonOutput(data: Py): string {
  return `${dumps(data, 2)}\n`
}

const meta = async (db: Db): Promise<PyDict> => {
  const row = await db.doc.findUnique({ where: { name: 'meta' } })
  return row === null ? {} : (loads(row.doc) as PyDict)
}

/** A uuid4's 32 hex digits from the run's counter. */
function mint(service: string, n: number): string {
  const hex = createHash('sha256').update(`${service}:${n}`).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = '89ab'[parseInt(hex[16]!, 16) % 4]!
  return hex.join('')
}

const time = (ctx: Ctx<Db>): PyFloat => new PyFloat(Date.parse(ctx.clock.lastIso()) / 1000)

/** Run one command on the run, as upstream's process would. */
async function answer(service: string, cli: string, app: string, command: Command, ctx: Ctx<Db>): Promise<Reply> {
  let args: Record<string, unknown> = {}
  if (ctx.body.length > 0) {
    const parsed = JSON.parse(ctx.body.toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { status: 400, body: 'Error: the options must be a JSON object\n' }
    args = parsed as Record<string, unknown>
  }
  const now = time(ctx)
  // The run's id counter and the class its calls log under.
  const m = await meta(ctx.db)
  let ids = typeof m.ids === 'number' ? m.ids : 0
  let minted = false
  const logged = typeof m.app === 'string' && m.app !== '' ? m.app : app
  let loaded: PyDict | undefined
  const take = <T>(name: string, fallback: T, check: (v: unknown) => boolean, kind: string): T => {
    const v = args[name]
    if (v === undefined || v === null) return fallback
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && (kind === 'float' || Number.isInteger(Number(v)))) return Number(v) as T
    if (!check(v)) throw new UsageError(`Invalid value for '--${name.replace(/_/g, '-')}': '${String(v)}' is not a valid ${kind}.`)
    return v as T
  }
  const call: Call = {
    args,
    drive: () => (typeof m.drive === 'string' ? m.drive : null),
    str: (name, fallback = null) => {
      const v = args[name]
      return v === undefined || v === null ? fallback : String(v)
    },
    int: (name, fallback = null) => take(name, fallback, (v) => Number.isInteger(v), 'integer'),
    float: (name, fallback = null) => {
      const v = take<number | null>(name, fallback, (x) => typeof x === 'number', 'float')
      return v === null ? null : Number.isInteger(v) ? new PyFloat(v) : v
    },
    flag: (name) => args[name] === true,
    list: (name) => {
      const v = args[name]
      return v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]).map(String)
    },
    now: () => now,
    uuidHex: () => {
      ids += 1
      minted = true
      return mint(service, ids)
    },
    uuidStr: () => {
      const h = call.uuidHex()
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    },
    state: async () => {
      if (loaded === undefined) {
        const row = await ctx.db.doc.findUnique({ where: { name: 'state' } })
        loaded = row === null ? {} : (loads(row.doc) as PyDict)
      }
      return loaded
    },
    save: async (state) => {
      const doc = dumps(state)
      await ctx.db.doc.upsert({ where: { name: 'state' }, create: { name: 'state', doc }, update: { doc } })
      loaded = loads(doc) as PyDict
    },
    log: async (fn, given, ret = null, write = false) => {
      const entry = { t: now, app: logged, fn, args: given, w: write, ret }
      await ctx.db.event.create({ data: { wall: performance.timeOrigin + performance.now(), entry: dumps(entry) } })
    },
  }
  let reply: Reply
  try {
    const out = await command.run(call)
    reply = { status: 200, body: out instanceof Printed ? out.text : jsonOutput(out) }
  } catch (error) {
    if (error instanceof CliError) reply = { status: 400, body: `${error.message}\n` }
    else if (error instanceof PyError) reply = { status: 400, body: `${error.type}: ${error.message}\n` }
    else if (error instanceof UsageError) {
      const usage = `Usage: ${cli} ${command.name} [OPTIONS]\nTry '${cli} ${command.name} --help' for help.\n\nError: ${error.message}\n`
      reply = { status: 400, body: usage }
    } else throw error
  }
  // A path on the drive prints as the workspace sees it (`/cloud-drive/...`),
  // where upstream prints its container's.
  if (typeof m.drive === 'string' && typeof m.view === 'string' && typeof reply.body === 'string') {
    reply = { ...reply, body: reply.body.split(m.drive).join(m.view) }
  }
  if (minted) {
    const doc = dumps({ ...m, ids })
    await ctx.db.doc.upsert({ where: { name: 'meta' }, create: { name: 'meta', doc }, update: { doc } })
  }
  return reply
}

/** An app's kit config: its schema is this directory's, linked from its own. */
export function appConfig(service: string, dir: string) {
  return parseConfig({ service, schema: join(dir, `${service}.prisma`), tenantKind: 'none' })
}

/**
 * An app's fake: each command a route, `POST /<cli>/<command>`, and a 404 for
 * anything else. A fixture names the `state` and `meta` docs; the event log
 * starts empty, as gaia2-init leaves `events.jsonl`.
 *
 * Args:
 *   service: the fake's name (`gaia2_contacts`), which names its ids too.
 *   cli: upstream's binary (`contacts`).
 *   app: upstream's `APP_NAME`, what it logs under when `meta` names no class.
 *   commands: upstream's commands, hidden ones included.
 */
export function appFake<C extends Db>(
  config: ReturnType<typeof appConfig>,
  client: new (options: { datasourceUrl: string }) => C,
  dmmf: Dmmf,
  service: string,
  cli: string,
  app: string,
  commands: () => Command[],
): Fake<C> {
  return {
    config,
    client,
    dmmf,
    seedRoots: { doc: 'Doc', event: 'Event' },
    // The trial's drive, which the reset names (`extras`): `drive`, its
    // directory on the host, and `view`, where the workspace mounts it.
    afterSeed: async (db, _tenant, _counts, extras) => {
      if (typeof extras.drive !== 'string') return
      const row = await db.doc.findUnique({ where: { name: 'meta' } })
      const doc = dumps({ ...(row === null ? {} : (loads(row.doc) as PyDict)), drive: extras.drive, view: extras.view ?? null })
      await db.doc.upsert({ where: { name: 'meta' }, create: { name: 'meta', doc }, update: { doc } })
    },
    routes: () => {
      const own: KitRoute<C>[] = commands().map((command) =>
        route<C>('POST', `/${cli}/${command.name}`, (ctx) => answer(service, cli, app, command, ctx as unknown as Ctx<Db>), { write: true }),
      )
      const missing = (ctx: Ctx<C>): Reply => ({ status: 404, body: { detail: `No such command: ${ctx.url.pathname}` } })
      return [...own, ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => route<C>(method, '/*rest', missing))]
    },
  }
}

/** This file's directory, for an app's config to find the schema it links. */
export const STORE = dirname(new URL(import.meta.url).pathname)

/** `d.get(key, fallback)`: the value where the key is present, even `None`. */
export function get<T extends Py | undefined = Py>(d: PyDict, key: string, fallback: T = null as T): Py | T {
  return Object.hasOwn(d, key) ? d[key]! : fallback
}

/** Python's `seq[start:end]`, negative and missing bounds included. */
export function slice<T>(seq: T[], start?: number | null, end?: number | null): T[] {
  const n = seq.length
  const at = (i: number | null | undefined, fallback: number) =>
    i === null || i === undefined ? fallback : i < 0 ? Math.max(0, n + i) : Math.min(i, n)
  const from = at(start, 0)
  const to = at(end, n)
  return to > from ? seq.slice(from, to) : []
}

/** Python's truthiness. */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false
  if (typeof value === 'number') return value !== 0
  if (value instanceof PyFloat) return value.value !== 0
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/**
 * `sorted(items, key=key, reverse=reverse)`: stable, and with `reverse`
 * equal keys keep their order, as Python's does.
 */
export function sorted<T>(items: Iterable<T>, key: (item: T) => number | string, reverse = false): T[] {
  const keyed = [...items].map((item, i) => ({ item, k: key(item), i }))
  keyed.sort((a, b) => {
    const c = a.k < b.k ? -1 : a.k > b.k ? 1 : 0
    return (reverse ? -c : c) || a.i - b.i
  })
  return keyed.map((x) => x.item)
}

/**
 * `json.loads(text)`, failing as Python's decoder does: a
 * `json.decoder.JSONDecodeError` (a ValueError) with its message and
 * position (`Expecting value: line 1 column 1 (char 0)`).
 */
export function jsonLoads(text: string): Py {
  const WS = ' \t\n\r'
  const fail = (msg: string, pos: number): never => {
    const line = text.slice(0, pos).split('\n').length
    const col = pos - text.lastIndexOf('\n', pos - 1)
    throw new PyError('json.decoder.JSONDecodeError', `${msg}: line ${line} column ${col} (char ${pos})`)
  }
  const ws = (i: number) => {
    while (i < text.length && WS.includes(text[i]!)) i++
    return i
  }
  class Stop {
    readonly at: number
    constructor(at: number) {
      this.at = at
    }
  }
  const string = (end: number): number => {
    const begin = end - 1
    for (;;) {
      if (end >= text.length) fail('Unterminated string starting at', begin)
      const ch = text[end]!
      if (ch === '"') return end + 1
      if (ch === '\\') {
        const esc = text[end + 1]
        if (esc === undefined) fail('Unterminated string starting at', begin)
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(end + 2, end + 6))) fail('Invalid \\uXXXX escape', end + 1)
          end += 6
        } else if ('"\\/bfnrt'.includes(esc!)) end += 2
        else fail('Invalid \\escape', end)
      } else if (ch.charCodeAt(0) < 0x20) fail('Invalid control character at', end)
      else end += 1
    }
  }
  const scan = (idx: number): number => {
    const ch = text[idx]
    if (ch === undefined) throw new Stop(idx)
    if (ch === '"') return string(idx + 1)
    if (ch === '{') return object(idx + 1)
    if (ch === '[') return array(idx + 1)
    for (const word of ['null', 'true', 'false', 'NaN', 'Infinity', '-Infinity']) {
      if (text.startsWith(word, idx)) return idx + word.length
    }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(text.slice(idx))
    if (m !== null) return idx + m[0].length
    throw new Stop(idx)
  }
  const value = (idx: number): number => {
    try {
      return scan(idx)
    } catch (stop) {
      if (stop instanceof Stop) return fail('Expecting value', stop.at)
      throw stop
    }
  }
  const object = (end: number): number => {
    let next = text[end] ?? ''
    if (next !== '"') {
      if (WS.includes(next) && next !== '') {
        end = ws(end)
        next = text[end] ?? ''
      }
      if (next === '}') return end + 1
      if (next !== '"') fail('Expecting property name enclosed in double quotes', end)
    }
    end += 1
    for (;;) {
      end = string(end)
      if (text[end] !== ':') {
        end = ws(end)
        if (text[end] !== ':') fail("Expecting ':' delimiter", end)
      }
      end = value(ws(end + 1))
      end = ws(end)
      next = text[end] ?? ''
      end += 1
      if (next === '}') return end
      if (next !== ',') fail("Expecting ',' delimiter", end - 1)
      end = ws(end)
      next = text[end] ?? ''
      end += 1
      if (next !== '"') fail('Expecting property name enclosed in double quotes', end - 1)
    }
  }
  const array = (end: number): number => {
    end = ws(end)
    if (text[end] === ']') return end + 1
    for (;;) {
      end = ws(value(end))
      const next = text[end] ?? ''
      end += 1
      if (next === ']') return end
      if (next !== ',') fail("Expecting ',' delimiter", end - 1)
      end = ws(end)
    }
  }
  let end = value(ws(0))
  end = ws(end)
  if (end !== text.length) fail('Extra data', end)
  // NaN and Infinity, which JSON.parse refuses, read as null; strings are kept.
  return loads(text.replace(/"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g, (token) => (token.startsWith('"') ? token : 'null')))
}

/**
 * `resolve_sandbox_path(path)`: a cloud-drive path's host file, under the
 * run's drive (`meta`'s `drive`, the trial's `/cloud-drive`), which a path
 * may not escape. A run with no drive resolves under a directory that does
 * not exist, so its files are not there.
 */
export function sandboxPath(drive: string | null, path: string): string {
  const root = resolve(drive ?? '/nonexistent/gaia2-drive')
  let rel = path.replace(/^~\/?/, 'home/userhome/')
  rel = rel.replace(/^~([^/]+)\/?/, 'home/$1/')
  rel = rel.replace(/^\/+/, '')
  const resolved = resolve(join(root, rel))
  if (!(resolved === root || resolved.startsWith(`${root}/`))) throw valueError(`Path escapes sandbox: ${path}`)
  return resolved
}
