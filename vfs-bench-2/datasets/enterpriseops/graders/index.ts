/**
 * EnterpriseOps-Gym's grader, native: a port of upstream's
 * benchmark/verifier.py (ServiceNow/EnterpriseOps-Gym, Apache-2.0).
 *
 * Upstream's verifier sends each `database_state` verifier's query to the
 * server's SQL runner, takes a value from the rows
 * (`_extract_value_from_sql_result`) and compares it with the expected one
 * (`_compare_values`). Here the fake answered each query already, through
 * its private state view, with the same runner (`query-<i>` of the
 * server's state, the i-th of its verifiers' queries in order), so the
 * grader reads rows from the VFS and runs no SQL.
 *
 * The comparisons are Python's: `5.0 == 5` and `True == 1`, an int against
 * a str raises (the verifier fails), and `contains` is `expected in
 * str(actual)`, where `str` prints a float as Python does. The fake marks a
 * float `{"__float__": v}` for that.
 */
import { PyFloat, reprFloat, reprStr } from '../../../workspace/py.ts'
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
import { Context, type Grade, type Grader, type InputSpec, type Row } from '../../../workspace/grader.ts'
import MANIFEST from './manifest.json' with { type: 'json' }

const PASS = Symbol('raises')

/** A row value with its Python type back: the fake's markers undone. */
function decode(value: any): any {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === 'object') {
    if (Object.hasOwn(value, '__float__')) {
      const v = value.__float__
      return new PyFloat(typeof v === 'number' ? v : v === 'inf' ? Infinity : v === '-inf' ? -Infinity : NaN)
    }
    if (Object.hasOwn(value, '__int__')) return BigInt(value.__int__)
    if (Object.hasOwn(value, '__bytes__')) return { __bytes__: value.__bytes__ }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]))
  }
  return value
}

/** A Python number's value, or undefined for a value that is not one (bool counts, as an int). */
function number(v: any): number | bigint | undefined {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'bigint') return v
  if (v instanceof PyFloat) return v.v
  return undefined
}

function numEq(a: number | bigint, b: number | bigint): boolean {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a === b
  if (typeof a === 'bigint') return Number.isInteger(b) && a === BigInt(b as number)
  if (typeof b === 'bigint') return Number.isInteger(a) && BigInt(a) === b
  return a === b
}

/** Python's `a == b` over the JSON values a verifier compares. */
export function pyEq(a: any, b: any): boolean {
  if (a === null || b === null) return a === b
  const x = number(a),
    y = number(b)
  if (x !== undefined || y !== undefined) return x !== undefined && y !== undefined && numEq(x, y)
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => pyEq(v, b[i]))
  }
  const ka = Object.keys(a),
    kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && pyEq(a[k], b[k]))
}

/** Python's `a < b` (-1), `==` (0), `>` (1), or PASS where Python raises TypeError. */
function pyOrder(a: any, b: any): -1 | 0 | 1 | typeof PASS {
  const x = number(a),
    y = number(b)
  if (x !== undefined && y !== undefined) {
    if (Number.isNaN(Number(x)) || Number.isNaN(Number(y))) return PASS
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const ca = Array.from(a, (c) => c.codePointAt(0)!),
      cb = Array.from(b, (c) => c.codePointAt(0)!)
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) if (ca[i] !== cb[i]) return ca[i]! < cb[i]! ? -1 : 1
    return ca.length < cb.length ? -1 : ca.length > cb.length ? 1 : 0
  }
  return PASS
}

/** Python's `repr`, as `str` of a container prints its items. */
function repr(v: any): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : reprFloat(v)
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof PyFloat) return reprFloat(v.v)
  if (typeof v === 'string') return reprStr(v)
  if (Array.isArray(v)) return `[${v.map(repr).join(', ')}]`
  if (Object.hasOwn(v, '__bytes__')) return `<bytes ${v.__bytes__}>`
  return `{${Object.entries(v)
    .map(([k, x]) => `${reprStr(k)}: ${repr(x)}`)
    .join(', ')}}`
}

/** Python's `str`. */
const pyStr = (v: any) => (typeof v === 'string' ? v : repr(v))

/** Upstream's `_extract_value_from_sql_result`, for the runner's rows. */
function extract(rows: Row[]): any {
  if (rows.length === 1 && Object.keys(rows[0]!).length === 1) return Object.values(rows[0]!)[0]
  if (rows.length === 1) return rows[0]
  return rows
}

/** Upstream's `_compare_values`. */
function compare(actual: any, expected: any, kind: string): boolean {
  if (kind === 'equals') return pyEq(actual, expected)
  if (kind === 'greater_than') return pyOrder(actual, expected) === 1
  if (kind === 'less_than') return pyOrder(actual, expected) === -1
  if (kind === 'contains') return typeof expected === 'string' && pyStr(actual).includes(expected)
  return false
}

export const enterpriseops: Grader = (c: Context): Grade => {
  const verifiers: any[] = c.json('/tests/verifiers.json')
  const asked = new Map<string, number>()
  const checks: Grade['checks'] = {}
  let passed = 0
  verifiers.forEach((verifier, i) => {
    const label = `${i}:${verifier.name ?? ''}`
    if (verifier.verifier_type !== 'database_state') {
      checks[label] = false
      return
    }
    const server = String(verifier.gym_name)
    const k = asked.get(server) ?? 0
    asked.set(server, k + 1)
    const rows = c.rows(server, `query-${k}`).map((row) => decode(row) as Row)
    const config = verifier.validation_config ?? {}
    // The runner refused or failed the query: upstream's verifier fails.
    const ok =
      !(rows.length === 1 && Object.hasOwn(rows[0]!, '__error__')) &&
      compare(extract(rows), config.expected_value ?? null, config.comparison_type ?? 'equals')
    checks[label] = ok
    passed += Number(ok)
  })
  const reward = verifiers.length > 0 && passed === verifiers.length ? 1 : 0
  return {
    score: reward,
    checks,
    rewards: { reward, verifiers_passed: passed, verifiers: verifiers.length },
  }
}

/** The EnterpriseOps-Gym tasks with a native grader: harbor/enterpriseops.py's manifest. */
export const ENTERPRISEOPS_GRADERS: Record<string, Grader> = Object.fromEntries(
  Object.keys((MANIFEST as { tasks: Record<string, unknown> }).tasks).map((task) => [task, enterpriseops])
)

export const GRADERS: Readonly<Record<string, Grader>> = Object.freeze(ENTERPRISEOPS_GRADERS)
export async function evaluate(input: InputSpec, command: CommandContext): Promise<Grade> {
  const grader = GRADERS[input.task]
  if (!grader) throw new Error(`No Mirage grader for ${input.task}`)
  const { completionOutput: _, ...completion } = grader(await Context.open(input, command))
  return completion
}
