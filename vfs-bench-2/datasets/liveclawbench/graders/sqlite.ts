/**
 * A SQLite file the agent left, read from its bytes, as SQLite reads a
 * rowid table: its schema's columns, each row's values in rowid order, and
 * `=` between a column and a text parameter. Native grading opens no
 * database, so corpus-file-injection's audit reads the agent's this way
 * (its two lookups, `sources` by id and every `facts` row).
 *
 * A file with no SQLite header is not a database (Python's
 * `sqlite3.DatabaseError`); a table or column the schema lacks is an
 * `OperationalError`. Only what those lookups need is read: no indexes, no
 * WITHOUT ROWID tables, no views.
 */
export class DatabaseError extends Error {}
export class OperationalError extends DatabaseError {}

export type Value = null | number | bigint | string | Uint8Array

interface Column {
  name: string
  /** SQLite's affinity of its declared type. */
  affinity: 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NUMERIC'
  nocase: boolean
  /** An INTEGER PRIMARY KEY: the rowid itself. */
  rowid: boolean
  /** Its DEFAULT, which a row written before ALTER TABLE ADD COLUMN reads. */
  fallback: Value
}

export interface Table {
  columns: Column[]
  rows: Value[][]
}

function affinity(type: string): Column['affinity'] {
  const t = type.toUpperCase()
  if (t.includes('INT')) return 'INTEGER'
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT'
  if (!t || t.includes('BLOB')) return 'BLOB'
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL'
  return 'NUMERIC'
}

const unquote = (name: string) => {
  const q = name[0]
  if (q === '"' || q === '`') return name.slice(1, -1).replaceAll(q + q, q)
  if (q === '[') return name.slice(1, -1)
  if (q === "'") return name.slice(1, -1).replaceAll("''", "'")
  return name
}

const CONSTRAINT = /^(CONSTRAINT|PRIMARY|NOT|NULL|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED|AS)$/i

/** A DEFAULT's constant, with the column's affinity, as SQLite reads it for a row stored before the column. */
function fallback(word: string | undefined, kind: Column['affinity']): Value {
  if (word === undefined) return null
  let text = word.trim()
  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim()
  if (/^NULL$/i.test(text)) return null
  if (/^TRUE$/i.test(text) || /^FALSE$/i.test(text)) return /^TRUE$/i.test(text) ? 1 : 0
  const numeric = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)
  if (text.startsWith("'")) {
    const value = unquote(text)
    const number = Number(value)
    if (kind !== 'TEXT' && kind !== 'BLOB' && value.trim() !== '' && Number.isFinite(number)) return number
    return value
  }
  if (numeric) return kind === 'TEXT' ? text.replace(/^\+/, '') : Number(text)
  return null
}

/** A definition's tokens: names, quoted names and parenthesized groups whole. */
function tokens(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    let j = i + 1
    if (ch === '"' || ch === "'" || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      while (j < text.length && !(text[j] === close && text[j + 1] !== close)) j += text[j] === close ? 2 : 1
      j++
    } else if (ch === '(') {
      for (let depth = 1; j < text.length && depth; j++) depth += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0
    } else while (j < text.length && !/[\s(]/.test(text[j]!)) j++
    out.push(text.slice(i, j))
    i = j
  }
  return out
}

/** Top-level comma-separated parts of a parenthesized list. */
function parts(body: string): string[] {
  const out: string[] = []
  let depth = 0,
    quote = '',
    part = ''
  for (const ch of body) {
    if (quote) {
      if (ch === (quote === '[' ? ']' : quote)) quote = ''
    } else if (ch === '"' || ch === "'" || ch === '`' || ch === '[') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(part)
      part = ''
      continue
    }
    part += ch
  }
  return [...out, part]
}

/** The columns of a `CREATE TABLE name (...)` statement, or null for a WITHOUT ROWID table. */
function columnsOf(sql: string): Column[] | null {
  const open = sql.indexOf('('),
    close = sql.lastIndexOf(')')
  if (open < 0 || close < open || /WITHOUT\s+ROWID/i.test(sql.slice(close))) return null
  const columns: Column[] = []
  let keyed: string | null = null
  for (const def of parts(sql.slice(open + 1, close)).map((d) => d.trim())) {
    const words = tokens(def)
    if (!words.length) continue
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(words[0]!)) {
      const key = /PRIMARY\s+KEY\s*\(([^,()]+)\)/i.exec(def)
      if (key) keyed = unquote(key[1]!.trim().split(/\s+/)[0]!)
      continue
    }
    const constraint = words.findIndex((w, i) => i > 0 && CONSTRAINT.test(w))
    const type = words.slice(1, constraint < 0 ? undefined : constraint).join(' ')
    const rest = words.slice(constraint < 0 ? words.length : constraint).join(' ')
    const kind = affinity(type.replace(/\(.*$/s, ''))
    const declared = words.findIndex((w, i) => i > 0 && /^DEFAULT$/i.test(w))
    columns.push({
      name: unquote(words[0]!),
      affinity: kind,
      nocase: /\bCOLLATE\s+NOCASE\b/i.test(rest),
      rowid: /^INTEGER$/i.test(type) && /\bPRIMARY\s+KEY\b(?!\s+DESC)/i.test(rest),
      fallback: declared < 0 ? null : fallback(words[declared + 1], kind),
    })
  }
  const key = columns.find((c) => keyed !== null && c.name.toLowerCase() === keyed.toLowerCase())
  if (key && key.affinity === 'INTEGER' && !columns.some((c) => c.rowid)) key.rowid = true
  return columns
}

/** A SQLite varint at `at`: its value and where the next begins. */
function varint(bytes: Uint8Array, at: number): [bigint, number] {
  let v = 0n
  for (let i = 0; i < 8; i++) {
    const b = bytes[at + i] ?? 0
    v = (v << 7n) | BigInt(b & 0x7f)
    if (!(b & 0x80)) return [v, at + i + 1]
  }
  return [(v << 8n) | BigInt(bytes[at + 8] ?? 0), at + 9]
}

const small = (v: bigint): number | bigint => (v >= -(2n ** 53n) && v <= 2n ** 53n ? Number(v) : v)

class File {
  readonly bytes: Uint8Array
  readonly view: DataView
  readonly pageSize: number
  readonly usable: number
  readonly utf: 'utf-8' | 'utf-16le' | 'utf-16be'
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    const magic = new TextDecoder().decode(bytes.subarray(0, 16))
    if (bytes.length < 100 || magic !== 'SQLite format 3\0') throw new DatabaseError('file is not a database')
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const size = this.view.getUint16(16)
    this.pageSize = size === 1 ? 65536 : size
    this.usable = this.pageSize - bytes[20]!
    this.utf = ['utf-8', 'utf-8', 'utf-16le', 'utf-16be'][this.view.getUint32(56)] as File['utf'] ?? 'utf-8'
    if (this.pageSize < 512 || this.pageSize & (this.pageSize - 1)) throw new DatabaseError('file is not a database')
  }
  page(n: number): number {
    const at = (n - 1) * this.pageSize
    if (n < 1 || at >= this.bytes.length) throw new DatabaseError('database disk image is malformed')
    return at
  }
  /** A table b-tree's cells, in rowid order: [rowid, payload]. */
  *cells(root: number, seen = new Set<number>()): Generator<[bigint, Uint8Array]> {
    if (seen.has(root)) throw new DatabaseError('database disk image is malformed')
    seen.add(root)
    const start = this.page(root),
      head = root === 1 ? start + 100 : start
    const kind = this.bytes[head]!
    const count = this.view.getUint16(head + 3)
    const header = kind === 0x05 ? 12 : 8
    if (kind !== 0x05 && kind !== 0x0d) throw new DatabaseError('database disk image is malformed')
    for (let i = 0; i < count; i++) {
      const cell = start + this.view.getUint16(head + header + 2 * i)
      if (kind === 0x05) {
        yield* this.cells(this.view.getUint32(cell), seen)
        continue
      }
      const [size, a] = varint(this.bytes, cell)
      const [rowid, b] = varint(this.bytes, a)
      // A payload lies within the file: a size past it is a malformed cell,
      // not an allocation to make.
      if (size > BigInt(this.bytes.length)) throw new DatabaseError('database disk image is malformed')
      yield [rowid, this.payload(b, Number(size))]
    }
    if (kind === 0x05) yield* this.cells(this.view.getUint32(head + 8), seen)
  }
  payload(at: number, size: number): Uint8Array {
    const u = this.usable,
      x = u - 35
    if (size <= x) return this.bytes.subarray(at, at + size)
    const m = Math.floor(((u - 12) * 32) / 255) - 23
    const k = m + ((size - m) % (u - 4))
    const local = k <= x ? k : m
    const out = new Uint8Array(size)
    out.set(this.bytes.subarray(at, at + local))
    let filled = local,
      next = this.view.getUint32(at + local)
    while (filled < size) {
      const page = this.page(next)
      const chunk = Math.min(u - 4, size - filled)
      out.set(this.bytes.subarray(page + 4, page + 4 + chunk), filled)
      filled += chunk
      next = this.view.getUint32(page)
    }
    return out
  }
  record(payload: Uint8Array): Value[] {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const malformed = () => new DatabaseError('database disk image is malformed')
    const [headerSize, first] = varint(payload, 0)
    // The header and each value lie within the payload; read nothing past it.
    if (headerSize < BigInt(first) || headerSize > BigInt(payload.length)) throw malformed()
    const end = Number(headerSize)
    const types: number[] = []
    for (let at = first; at < end; ) {
      const [t, next] = varint(payload, at)
      if (next > end) throw malformed()
      types.push(Number(t))
      at = next
    }
    const sizes = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0]
    const length = (t: number) => (t < 10 ? sizes[t]! : t >= 12 ? Math.floor((t - 12) / 2) : 0)
    if (types.reduce((sum, t) => sum + length(t), end) > payload.length) throw malformed()
    const values: Value[] = []
    let at = end
    for (const t of types) {
      if (t === 0) values.push(null)
      else if (t >= 1 && t <= 6) {
        const n = [0, 1, 2, 3, 4, 6, 8][t]!
        values.push(small(BigInt.asIntN(8 * n, payload.subarray(at, at + n).reduce((acc, b) => (acc << 8n) | BigInt(b), 0n))))
        at += n
      } else if (t === 7) {
        values.push(view.getFloat64(at))
        at += 8
      } else if (t === 8 || t === 9) values.push(t - 8)
      else if (t >= 12 && t % 2 === 0) {
        const n = (t - 12) / 2
        values.push(payload.slice(at, at + n))
        at += n
      } else if (t >= 13) {
        const n = (t - 13) / 2
        values.push(new TextDecoder(this.utf).decode(payload.subarray(at, at + n)))
        at += n
      } else throw new DatabaseError('database disk image is malformed')
    }
    return values
  }
}

/** The named table (its name compared as SQLite does, ignoring ASCII case). */
export function table(bytes: Uint8Array, name: string): Table {
  if (!bytes.length) throw new OperationalError(`no such table: ${name}`)
  const file = new File(bytes)
  for (const [, payload] of file.cells(1)) {
    const [type, entry, , root, sql] = file.record(payload)
    if (type !== 'table' || typeof entry !== 'string' || entry.toLowerCase() !== name.toLowerCase()) continue
    const columns = typeof sql === 'string' ? columnsOf(sql) : null
    if (columns === null || typeof root !== 'number') throw new OperationalError(`no such table: ${name}`)
    const rows: Value[][] = []
    for (const [rowid, cell] of file.cells(root)) {
      const values = file.record(cell)
      // A row stored before ALTER TABLE ADD COLUMN reads that column's DEFAULT.
      rows.push(columns.map((c, i) => (c.rowid ? small(rowid) : i < values.length ? values[i]! : c.fallback)))
    }
    return { columns, rows }
  }
  throw new OperationalError(`no such table: ${name}`)
}

/** A column's index, or the OperationalError SQLite raises for it. */
export function column(t: Table, name: string): number {
  const i = t.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
  if (i < 0) throw new OperationalError(`no such column: ${name}`)
  return i
}

/** `column = ?` with a text parameter: a text value equal under the column's collation. */
export function equalsText(t: Table, i: number, value: Value, text: string): boolean {
  if (typeof value !== 'string') return false
  const nocase = t.columns[i]!.nocase
  const fold = (s: string) => (nocase ? s.replace(/[A-Z]/g, (c) => c.toLowerCase()) : s)
  return fold(value) === fold(text)
}
