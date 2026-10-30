/** Frozen, declared verifier inputs. No agent code, network, or Python runtime. */
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type Row = Record<string, any>
export interface Grade {
  score: number
  checks: Record<string, boolean | number | string>
  rewards?: Record<string, number>
  artifacts?: Record<string, unknown>
}
export interface Inputs {
  task: string
  databases: Record<string, string>
  files?: Record<string, string>
  existingPaths?: string[]
  epoch?: string
  env?: Record<string, string>
  timeoutSeconds: number
}
export type Grader = (context: Context) => Grade
export class Context {
  private opened = new Map<string, DatabaseSync>()
  readonly input: Inputs
  constructor(input: Inputs) {
    this.input = input
  }
  exists(path: string) {
    return (
      Object.hasOwn(this.input.files ?? {}, path) ||
      Object.hasOwn(this.input.databases, path) ||
      Boolean(this.input.existingPaths?.includes(path))
    )
  }
  text(path: string, fallback?: string): string {
    const host = this.input.files?.[path]
    if (host === undefined) {
      if (fallback !== undefined) return fallback
      throw new Error(`Missing frozen input: ${path}`)
    }
    return readFileSync(host, 'utf8')
  }
  json(path: string, fallback?: any): any {
    if (!this.exists(path) && fallback !== undefined) return fallback
    return JSON.parse(this.text(path))
  }
  jsonInteger(path: string, key: string): boolean {
    // Python distinguishes JSON 0 from 0.0. Keep that distinction for
    // graders using type(value) is int, which Number.isInteger loses.
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
  db(path: string): DatabaseSync {
    let db = this.opened.get(path)
    if (!db) {
      const host = this.input.databases[path]
      if (!host) throw new Error(`Missing frozen database: ${path}`)
      db = new DatabaseSync(host, { readOnly: true, allowExtension: false })
      this.opened.set(path, db)
    }
    return db
  }
  all(path: string, sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db(path)
      .prepare(sql)
      .all(...params)
  }
  one(path: string, sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db(path)
      .prepare(sql)
      .get(...params)
  }
  scalar(path: string, sql: string, ...params: SQLInputValue[]): any {
    const row = this.one(path, sql, ...params)
    return row ? Object.values(row)[0] : undefined
  }
  close() {
    for (const db of this.opened.values()) db.close()
    this.opened.clear()
  }
  now() {
    return new Date(this.input.epoch ?? '2026-04-03T09:00:00Z')
  }
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
export function mails(c: Context, sent = true): Mail[] {
  const where = sent
    ? "WHERE EXISTS (SELECT 1 FROM MessageLabel l WHERE l.tenant = m.tenant AND l.messageId = m.id AND l.labelId = 'SENT') AND NOT EXISTS (SELECT 1 FROM MessageLabel l WHERE l.tenant = m.tenant AND l.messageId = m.id AND l.labelId = 'TRASH')"
    : ''
  return c.all(GWS, `SELECT id, bodyText FROM Message m ${where} ORDER BY seq`).map((r) => {
    const headers = c.all(GWS, 'SELECT name, value FROM MessageHeader WHERE messageId = ? ORDER BY seq', r.id)
    return {
      id: r.id,
      to: addresses(headers.filter((h) => lower(h.name) === 'to').map((h) => h.value)),
      subject: headers.find((h) => lower(h.name) === 'subject')?.value ?? '',
      body: r.bodyText ?? '',
    }
  })
}
export const mailText = (m: Mail) => m.subject + '\n' + m.body
