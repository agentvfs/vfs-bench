/**
 * What ComplexMCP's apps share: upstream's `software/utils/` (the id
 * alphabet, `TimeMachine`), the OS connector each app holds to LightSystem's
 * clock, and the bits of Python's semantics their handlers lean on
 * (slicing, indexing, errors).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDocument, visit } from 'yaml'

import { PyFloat, formatStamp, parseStamp } from './py.ts'
import type { PyRandom } from './pyrandom.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Upstream's checkout, which `complexmcp/setup.py` downloads. */
export const UPSTREAM = process.env.COMPLEXMCP_SRC ?? join(HERE, '..', '..', 'state', 'complexmcp', 'src')

/** A corpus file of an app, `software/<app>/corpus/<name>`, as PyYAML's safe_load reads it. */
export function corpus<T>(app: string, name: string): T {
  const doc = parseDocument(readFileSync(join(UPSTREAM, 'software', app, 'corpus', name), 'utf8'), { version: '1.1' })
  // A plain number written with a point or an exponent is a Python float.
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'number' && node.type === 'PLAIN' && /[.eE]/.test(node.source ?? '')) {
        node.value = new PyFloat(node.value)
      }
    },
  })
  return doc.toJS() as T
}

/**
 * A Python exception a handler raises. fastmcp answers it as the tool's
 * error, `Error calling tool '<tool>': <str(exception)>`.
 */
export class PyError extends Error {}

/** `KeyError(key)`, whose str is the key's repr. */
export const keyError = (key: string): PyError => new PyError(`'${key}'`)

/**
 * LightSystem's clock, as an app's `OSConnector` reaches it: `now`, `step`
 * (forward 1 to 10 s, a draw of the clock's own generator) and `gen_past`.
 */
export interface Os {
  now(): Promise<string>
  step(): Promise<string>
  genPast(startYear: number, k: number): Promise<string[]>
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** `uuid_rng(rng)`: 22 of the alphabet, by `choices`; LightWeather's ids take 12. */
export function uuid(rng: PyRandom, k = 22): string {
  return rng.choices([...ALPHABET], k).join('')
}

/** `TimeMachine.gen(years)`: a random second of a random year. */
export function timeGen(rng: PyRandom, years: [number, number] = [2015, 2025]): string {
  const year = rng.randint(years[0], years[1])
  const start = Date.UTC(year, 0, 1)
  const total = (Date.UTC(year + 1, 0, 1) - start) / 1000
  const seconds = rng.randint(0, total - 1)
  return formatStamp(start + seconds * 1000)
}

/** `TimeMachine.add_secs(timestamp, min_secs, max_secs)`. */
export function addSecs(rng: PyRandom, timestamp: string, minSecs = 10, maxSecs = 1_000_000): string {
  const t = parseStamp(timestamp)
  if (t === null) throw new PyError(`time data '${timestamp}' does not match format '%Y-%m-%d %H:%M:%S'`)
  return formatStamp(t + rng.randint(minSecs, maxSecs) * 1000)
}

/** Python's `seq[start:stop]`. */
export function slice<T>(seq: readonly T[], start?: number, stop?: number): T[] {
  const n = seq.length
  const at = (i: number | undefined, dflt: number) => (i === undefined ? dflt : i < 0 ? Math.max(0, n + i) : Math.min(i, n))
  const a = at(start, 0)
  const b = at(stop, n)
  return a < b ? seq.slice(a, b) : []
}

/** Python's `seq[i]`, or IndexError's message. */
export function index<T>(seq: readonly T[], i: number): T {
  const j = i < 0 ? seq.length + i : i
  if (j < 0 || j >= seq.length) throw new PyError('list index out of range')
  return seq[j]!
}

/** `list.pop(i)`. */
export function pop<T>(seq: T[], i: number): T {
  if (seq.length === 0) throw new PyError('pop from empty list')
  const j = i < 0 ? seq.length + i : i
  if (j < 0 || j >= seq.length) throw new PyError('pop index out of range')
  return seq.splice(j, 1)[0]!
}

/** A deep copy that keeps floats floats (`dataclasses.asdict`, `dict(x)`). */
export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof PyFloat) return value
  if (Array.isArray(value)) return value.map(clone) as T
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T
}

/** `sorted(xs, key=key)`: stable, by Python's ordering of the keys. */
export function sorted<T>(xs: readonly T[], key: (x: T) => unknown = (x) => x): T[] {
  return [...xs].sort((a, b) => compare(key(a), key(b)))
}

/** Python's `<` over strings, numbers, booleans and tuples (arrays) of them. */
export function compare(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compare(a[i], b[i])
      if (c !== 0) return c
    }
    return a.length - b.length
  }
  if (typeof a === 'string' && typeof b === 'string') return codePointCompare(a, b)
  const x = Number(a)
  const y = Number(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function codePointCompare(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (c !== 0) return c
  }
  return x.length - y.length
}
