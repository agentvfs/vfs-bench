/** Native verifier data comes only through Mirage's VFS and virtual shell. */
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
export type Row = Record<string, any>
export type Tables = Record<string, Row[]>
export interface Grade {
  score: number
  checks: Record<string, boolean | number | string>
  rewards?: Record<string, number>
  artifacts?: Record<string, unknown>
}
/** Serializable input transport; file values are base64 bytes, never host paths. */
export interface Inputs {
  task: string
  states: Record<string, Tables>
  files?: Record<string, string>
  existingPaths?: string[]
  epoch?: string
  env?: Record<string, string>
  timeoutSeconds: number
}
export type Grader = (context: Context) => Grade
export type InputSpec = Omit<Inputs, 'states' | 'files'> & { states: Record<string, string>; files: string[] }
export class Context {
  readonly input: InputSpec
  private states: Record<string, Tables>
  private files: Map<string, string>
  private constructor(input: InputSpec, states: Record<string, Tables>, files: Map<string, string>) {
    this.input = input
    this.states = states
    this.files = files
  }
  static async open(input: InputSpec, command: CommandContext): Promise<Context> {
    if (!command.vfs || !command.shell) throw new Error('Grading requires Mirage VFS and shell access')
    const states: Record<string, Tables> = {}
    const files = new Map<string, string>()
    for (const [name, path] of Object.entries(input.states)) {
      const output = '/.verifier-output/state.json'
      const out = await command.shell('jq -c . ' + quote(path) + ' > ' + quote(output))
      if (out.exitCode !== 0) throw new Error(`Cannot read verifier state ${name}`)
      const value = JSON.parse(new TextDecoder().decode(await command.vfs.read(output)))
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.values(value).some((v) => !Array.isArray(v))
      )
        throw new Error(`Invalid state ${name}`)
      states[name] = value
    }
    await Promise.all(
      input.files.map(async (path) => {
        files.set(path, new TextDecoder().decode(await command.vfs!.read(path, { raw: true })))
      })
    )
    return new Context(input, states, files)
  }
  exists(path: string) {
    return (
      this.files.has(path) ||
      Object.hasOwn(this.states, path) ||
      Boolean(this.input.existingPaths?.includes(path))
    )
  }
  text(path: string, fallback?: string): string {
    const text = this.files.get(path)
    if (text !== undefined) return text
    if (fallback !== undefined) return fallback
    throw new Error(`Missing VFS input: ${path}`)
  }
  json(path: string, fallback?: any): any {
    if (!this.exists(path) && fallback !== undefined) return fallback
    return JSON.parse(this.text(path))
  }
  jsonInteger(path: string, key: string): boolean {
    const flags = new WeakMap<object, Map<string, boolean>>()
    const parsed = JSON.parse(this.text(path), function (
      this: object,
      key: string,
      value: any,
      context: { source?: string }
    ) {
      if (typeof value === 'number') {
        if (!flags.has(this)) flags.set(this, new Map())
        flags.get(this)!.set(key, /^-?(?:0|[1-9]\d*)$/.test(context.source ?? ''))
      }
      return value
    } as any)
    return parsed !== null && typeof parsed === 'object' && flags.get(parsed)?.get(key) === true
  }
  rows(source: string, table: string): Row[] {
    const rows = this.states[source]?.[table]
    if (!rows) throw new Error(`Missing VFS table: ${source}/${table}`)
    return [...rows]
  }
  now() {
    return new Date(this.input.epoch ?? '2026-04-03T09:00:00Z')
  }
}
export const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
// Preserve the references' missing-value and comparison semantics on JSON rows.
export const eq = (a: any, b: any) => a != null && b != null && a === b
export const ne = (a: any, b: any) => a != null && b != null && a !== b
export const gt = (a: any, b: any) => a != null && b != null && a > b
export const ge = (a: any, b: any) => a != null && b != null && a >= b
export const lt = (a: any, b: any) => a != null && b != null && a < b
export const le = (a: any, b: any) => a != null && b != null && a <= b
export const asciiLower = (s: any): string => String(s ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase())
export function instantDate(value: any): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(
    value.includes('T') || value.includes(' ')
      ? value.replace(' ', 'T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? '' : 'Z')
      : value
  )
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null
}
export function like(value: any, pattern: string): boolean {
  if (value == null) return false
  const re = [...asciiLower(pattern)]
    .map((c) => (c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp('^' + re + '$', 'u').test(asciiLower(value))
}
export function compare(a: any, b: any): number {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'string' && typeof b === 'string') {
    const aa = [...a],
      bb = [...b]
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      const diff = aa[i]!.codePointAt(0)! - bb[i]!.codePointAt(0)!
      if (diff) return diff
    }
    return aa.length - bb.length
  }
  return a < b ? -1 : 1
}
export const orderBy =
  (...keys: [string, number][]) =>
  (a: Row, b: Row) => {
    for (const [key, direction] of keys) {
      const cmp = compare(a[key], b[key])
      if (cmp) return cmp * direction
    }
    return 0
  }
export function grade(score: number, checks: Grade['checks'] = {}): Grade {
  return { score, checks }
}
export function dimensions(
  values: Record<string, number>,
  score = round(
    Object.values(values).reduce((a, b) => a + b, 0),
    3
  )
): Grade {
  return { score, checks: values, rewards: { reward: score, ...values } }
}
/** CPython's round(float, ndigits): ties to even on the exact binary value. */
export function round(value: number, digits = 0): number {
  if (!Number.isFinite(value) || value === 0) return value
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, Math.abs(value))
  const bits = buf.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n)
  let numerator = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)
  let denominator = 1n
  const shift = (exponent || 1) - 1023 - 52
  if (shift >= 0) numerator <<= BigInt(shift)
  else denominator <<= BigInt(-shift)
  if (digits >= 0) numerator *= 10n ** BigInt(digits)
  else denominator *= 10n ** BigInt(-digits)
  let q = numerator / denominator
  const remainder = numerator % denominator
  if (remainder * 2n > denominator || (remainder * 2n === denominator && q % 2n !== 0n)) q++
  return (Math.sign(value) * Number(q)) / 10 ** digits
}
export const lower = (value: any): string => String(value ?? '').toLowerCase()
export const containsAny = (text: string, needles: string[]) => needles.some((s) => text.includes(s))
export const lines = (text: string) =>
  text === ''
    ? []
    : text
        .replace(/\r\n/g, '\n')
        .replace(/\n$/, '')
        .split(/\n|\r|\v|\f|\u0085|\u2028|\u2029/)
export const GWS = '/var/lib/mock-data/gws/gws.db'
export const FINANCE = '/opt/mock/data/finance_app.sqlite'
export const SOCIAL = '/var/lib/mock-data/social/social.db'

// The task headers use RFC 5322 mailbox lists, including quoted display
// names, groups, comments and multiple To fields. Preserve address case.
export function addresses(headers: string[]): string[] {
  const result: string[] = []
  for (const header of headers) {
    let part = '',
      quote = false,
      escape = false,
      comment = 0,
      angle = 0
    const flush = () => {
      let s = part.trim()
      part = ''
      if (!s) return
      const m = s.match(/<([^<>]*)>/)
      if (m) s = m[1]!.trim()
      else s = s.replace(/^.*:\s*/, '').trim()
      if (s && !/[<>]/.test(s)) result.push(s.replace(/^"(.*)"$/, '$1'))
    }
    for (const ch of header) {
      if (escape) {
        if (!comment) part += ch
        escape = false
        continue
      }
      if (ch === '\\' && (quote || comment)) {
        escape = true
        if (!comment) part += ch
        continue
      }
      if (!quote && ch === '(') {
        comment++
        continue
      }
      if (comment) {
        if (ch === ')') comment--
        continue
      }
      if (ch === '"') quote = !quote
      if (!quote) {
        if (ch === '<') angle++
        if (ch === '>') angle--
        if ((ch === ',' || ch === ';') && !angle) {
          flush()
          continue
        }
        if (ch === ':' && !angle) {
          part = ''
          continue
        }
      }
      part += ch
    }
    if (quote || comment || angle) return []
    flush()
  }
  return result
}
export interface Mail {
  to: string[]
  subject: string
  body: string
  id: string
}
export function sentMessages(c: Context): Row[] {
  const labels = c.rows(GWS, 'MessageLabel')
  return c.rows(GWS, 'Message').filter((m) => {
    const own = labels.filter((l) => eq(l.tenant, m.tenant) && eq(l.messageId, m.id))
    return own.some((l) => l.labelId === 'SENT') && !own.some((l) => l.labelId === 'TRASH')
  })
}
export function mails(c: Context, sent = true): Mail[] {
  return (sent ? sentMessages(c) : c.rows(GWS, 'Message')).sort(orderBy(['seq', 1])).map((r) => {
    const headers = c
      .rows(GWS, 'MessageHeader')
      .filter((h) => eq(h.messageId, r.id))
      .sort(orderBy(['seq', 1]))
    return {
      id: r.id,
      to: addresses(headers.filter((h) => lower(h.name) === 'to').map((h) => h.value)),
      subject: headers.find((h) => lower(h.name) === 'subject')?.value ?? '',
      body: r.bodyText ?? '',
    }
  })
}
export const mailText = (m: Mail) => m.subject + '\n' + m.body
