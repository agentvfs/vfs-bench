/**
 * A run's world, as upstream's handlers get it (`world: WorldState`), and
 * what every service's port shares: Python's argument binding, the route
 * table of `make_router`, and the services' registry.
 *
 * `World.data` is the world's JSON (`model_dump(mode="json")`): `meta` and
 * each service the task is subscribed to, which a handler reads and changes
 * in place. Its clock is the task's epoch, on by a second for each
 * `api_fetch` call (`calls`), upstream's `datetime.now()`; `random` is the
 * `random` module's generator and `ids` the one `uuid.uuid4()` draws from,
 * each where the fixture, then the calls before, left it.
 */
import { PyDateTime, PyTimedelta } from './pydt.ts'
import { type Py, type PyDict, PyError, copy, dumps, isDict, typeName } from './py.ts'
import { PyRandom, PyUUID } from './pyrandom.ts'

/** The `meta` doc: the task, its clock and its generators' states. */
export interface Meta {
  task: string
  epoch: string
  calls: number
  random: number[]
  ids: number[]
  /**
   * State upstream keeps on the world outside its fields, which
   * `model_dump` drops but the rubric reads: by service, e.g.
   * `google_sheets._updated_row_keys` (sorted keys of the set
   * `_mark_row_updated` fills). The verifier puts it back.
   */
  hidden?: Record<string, PyDict>
}

export class World {
  readonly data: PyDict
  readonly random = new PyRandom()
  readonly ids = new PyRandom()
  readonly epoch: PyDateTime
  calls: number
  readonly task: string
  /** `Meta.hidden`: upstream's attributes set outside the model's fields, by service. */
  readonly hidden: Record<string, PyDict>

  constructor(data: PyDict, meta: Meta) {
    this.hidden = meta.hidden ?? {}
    this.data = data
    this.task = meta.task
    this.epoch = PyDateTime.fromisoformat(meta.epoch.replace(/Z$/, '+00:00')).utc()
    this.calls = meta.calls
    this.random.setstate(meta.random)
    this.ids.setstate(meta.ids)
  }

  meta(): Meta {
    const meta: Meta = { task: this.task, epoch: this.epoch.json(), calls: this.calls, random: this.random.getstate(), ids: this.ids.getstate() }
    if (Object.keys(this.hidden).length > 0) meta.hidden = this.hidden
    return meta
  }

  /** `datetime.now(timezone.utc)`. */
  now(): PyDateTime {
    return this.epoch.add(PyTimedelta.of({ seconds: this.calls }))
  }

  /** `datetime.now()`: the naive wall time, UTC's. */
  nowNaive(): PyDateTime {
    return this.now().replace({ offset: null })
  }

  /** `time.time()`. */
  time(): number {
    return this.now().timestamp()
  }

  /** `uuid.uuid4()`. */
  uuid4(): PyUUID {
    return PyUUID.v4(this.ids)
  }

  /** A service's state, `world.<name>`. */
  service(name: string): PyDict {
    const state = this.data[name]
    if (!isDict(state)) throw new Error(`the world has no ${name}: the task is not subscribed to it`)
    return state
  }

  /** `world.meta.allowed_services`. */
  get allowed(): string[] | null {
    const meta = this.data.meta as PyDict
    return (meta.allowed_services as string[] | null) ?? null
  }

  /** `world.meta.current_time`, as stored. */
  get currentTime(): PyDateTime {
    return PyDateTime.fromisoformat(String((this.data.meta as PyDict).current_time).replace(/Z$/, '+00:00'))
  }
}

// ---------------------------------------------------------------------------
// Python's call binding
// ---------------------------------------------------------------------------

/** A parameter: its name, with its default where it has one. */
export type Param = string | [string, Py]

/** A Python function's signature, for binding a call to it as Python does. */
export interface Signature {
  /** `module.qualname`, which `**` of a non-mapping names. */
  module: string
  name: string
  params: Param[]
  /** Whether it takes `**kwargs`. */
  kwargs: boolean
}

export function sig(module: string, name: string, params: Param[], kwargs = true): Signature {
  return { module, name, params, kwargs }
}

export interface Bound {
  [name: string]: Py | PyDict
  kwargs: PyDict
}

/**
 * `f(*positional, **keywords)`: each parameter's value, its default where
 * not given, and the rest in `kwargs`; or Python's `TypeError`.
 */
export function bind(signature: Signature, positional: unknown[], keywords: unknown = {}): Bound {
  const { module, name, params } = signature
  if (!isDict(keywords)) throw new PyError('TypeError', `${module}.${name}() argument after ** must be a mapping, not ${typeName(keywords)}`)
  const names = params.map((p) => (typeof p === 'string' ? p : p[0]))
  if (positional.length > names.length) {
    throw new PyError('TypeError', `${name}() takes ${names.length} positional arguments but ${positional.length} were given`)
  }
  const out: Bound = { kwargs: {} }
  positional.forEach((v, i) => {
    out[names[i]!] = v as Py
  })
  for (const [k, v] of Object.entries(keywords)) {
    const i = names.indexOf(k)
    if (i >= 0 && i < positional.length) throw new PyError('TypeError', `${name}() got multiple values for argument '${k}'`)
    if (i >= 0) out[k] = v
    else if (signature.kwargs) out.kwargs[k] = v
    else throw new PyError('TypeError', `${name}() got an unexpected keyword argument '${k}'`)
  }
  const missing: string[] = []
  params.forEach((p, i) => {
    const n = names[i]!
    if (Object.hasOwn(out, n) && n !== 'kwargs') return
    if (typeof p === 'string') missing.push(n)
    else out[n] = copy(p[1])
  })
  if (missing.length > 0) {
    const quoted = missing.map((m) => `'${m}'`)
    const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
    throw new PyError('TypeError', `${name}() missing ${missing.length} required positional argument${missing.length === 1 ? '' : 's'}: ${list}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// make_router
// ---------------------------------------------------------------------------

/** A route's handler: `(world, ids, params, body_dict) -> str`. */
export type Handler = (world: World, ids: (string | null)[], params: PyDict, body: Py) => string

export type Route = [method: string, pattern: string, key: string]

export type Router = (world: World, method: string, path: string, params: PyDict, body: Py) => string

/** `make_router(routes, handlers)`: the first route whose method and pattern (`re.match`) fit. */
export function makeRouter(routes: Route[], handlers: Record<string, Handler>): Router {
  const compiled = routes.map(([method, pattern, key]) => {
    if (handlers[key] === undefined) throw new Error(`route ${method} ${pattern}: no handler ${key}`)
    return { method, re: new RegExp(`^(?:${pattern.replace(/\$$/, '(?=\\n?$)')})`), key }
  })
  return (world, method, path, params, body) => {
    const upper = method.toUpperCase()
    for (const r of compiled) {
      if (r.method !== upper) continue
      const m = r.re.exec(path)
      if (m === null) continue
      return handlers[r.key]!(world, m.slice(1).map((g) => g ?? null), params, body)
    }
    return dumps({ error: { code: 404, message: `No handler for ${method} ${path}` } })
  }
}

/** Each service's router, by the name upstream exports it under (`route_<service>`). */
export const ROUTERS: Record<string, Router> = {}

/** Register a service's router (its port's module does, when loaded). */
export function register(service: string, router: Router): void {
  ROUTERS[service] = router
}
