/**
 * ERPBench-100's world (`erpbench100/world.py`, blobfishai/erp-agent-simulation
 * 5bdf458): `ErpWorld._dispatch` and its views, statement for statement, on
 * the run's SQLite file. Python ints are JS numbers (bigints past 2^53),
 * floats `PyFloat`s, as `Conn` reads them and `loads` parses them.
 */
import { pyEq, pyLen, pyType, round, fsum, str, strip, toFloat, truthy, PyFloat } from '../complexmcp/py.ts'
import { loads } from '../enterpriseops/py.ts'
import type { Conn, Row } from '../enterpriseops/sqlite.ts'
import { type Dict, PyExc, asNum, at, deepcopy, dumps, get, isDict, isNumber, lowerOf, put, pyInt, reSubject, typeError, valueError } from './py.ts'

export const AS_OF = '2026-02-09T09:00:00Z'
export const AS_OF_DATE = '2026-02-09'

export const SERVER_BY_PREFIX: Record<string, string> = {
  erpbench: 'erpbench',
  oracle_fusion: 'oracle_fusion',
  gmail: 'gmail',
  google_drive: 'google_drive',
  google_sheets: 'google_sheets',
  slack: 'slack',
}

/** What the exporter (harbor/erpbench.py `kit`) writes for a task: the fields upstream's tools read. */
export interface Kit {
  task: Dict
  model: Dict
  tools: Dict[]
  sql: string
}

const json = (v: unknown) => dumps(v, true)

/** `_row`: a row as a dict, each `*_json` column decoded under its name without the suffix. */
function decode(row: Row | null): Dict | null {
  if (row === null) return null
  const out: Dict = {}
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_json')) put(out, k.slice(0, -5), loads(v as string))
    else put(out, k, v)
  }
  return out
}

/** `TABLES`: the tables `ErpWorld.snapshot` reads, in its order. */
const TABLES = [
  'tenants', 'users', 'items', 'customers', 'suppliers', 'sales_orders', 'shipments', 'shipment_lines',
  'receivables_invoices', 'standard_receipts', 'onhand_balances', 'purchase_orders', 'purchase_order_lines',
  'purchase_requisitions', 'receiving_receipt_requests', 'ap_invoices', 'invoice_holds', 'workers',
  'document_records', 'absences', 'channel_orders', 'mail_messages', 'mail_drafts', 'drive_files',
  'spreadsheets', 'sheet_changes', 'chat_messages', 'chat_posts', 'decisions', 'submissions', 'audit_log',
]

/** `ErpWorld.snapshot`: every table's rows, ordered by their first column. */
export function snapshot(conn: Conn): Dict {
  const out: Dict = {}
  for (const table of TABLES) put(out, table, conn.execute(`SELECT * FROM ${table} ORDER BY 1`).fetchall().map((row) => decode(row)!))
  return out
}

const plus = (a: unknown, b: unknown) => new PyFloat(asNum(a as PyFloat) + asNum(b as PyFloat))
const times = (q: number | bigint, p: PyFloat) => new PyFloat(Number(q) * p.v)
const or = (x: unknown, y: unknown) => (truthy(x) ? x : y)

/** `d.get(key)` where the key is any JSON value: unhashable ones raise. */
function lookup(d: Dict, key: unknown): unknown {
  if (Array.isArray(key) || isDict(key)) throw typeError(`unhashable type: '${pyType(key)}'`)
  return typeof key === 'string' && Object.hasOwn(d, key) ? d[key] : null
}

/** `d[key] = v`, then `_json(d)`'s sort, for a key that may not be a str. */
function store(d: Dict, key: unknown, value: unknown): void {
  if (Array.isArray(key) || isDict(key)) throw typeError(`unhashable type: '${pyType(key)}'`)
  if (typeof key !== 'string') throw typeError(`'<' not supported between instances of '${pyType(key)}' and 'str'`)
  put(d, key, value)
}

export class World {
  readonly task: Dict
  readonly model: Dict
  readonly world: Dict
  readonly short: string
  readonly code: string
  readonly conn: Conn

  constructor(kit: Kit, conn: Conn) {
    this.task = kit.task
    this.model = kit.model
    this.world = kit.model.world as Dict
    this.short = this.world.short as string
    this.code = kit.task.tenant_code as string
    this.conn = conn
  }

  /** `connection.execute`, refusing a parameter Python's sqlite3 cannot bind as it does. */
  private ex(sql: string, params: unknown[] = []) {
    params.forEach((p, i) => {
      if (Array.isArray(p) || isDict(p)) throw new PyExc('ProgrammingError', `Error binding parameter ${i + 1}: type '${pyType(p)}' is not supported`)
    })
    return this.conn.execute(sql, params)
  }

  private row(sql: string, params: unknown[]): Dict | null {
    return decode(this.ex(sql, params).fetchone())
  }

  private one(sql: string, params: unknown[]): Dict {
    const value = this.row(sql, params)
    if (value === null) throw valueError('record not found')
    return value
  }

  private all(sql: string, params: unknown[] = []): Dict[] {
    return this.ex(sql, params)
      .fetchall()
      .map((r) => decode(r) ?? {})
  }

  private count(sql: string, params: unknown[]): number {
    return Object.values(this.ex(sql, params).fetchone()!)[0] as number
  }

  private audit(tool: string, target: unknown, payload: Dict): void {
    this.ex('INSERT INTO audit_log(task_id, tool, target, payload_json) VALUES (?, ?, ?, ?)', [get(payload, 'task_id'), tool, target, json(payload)])
  }

  private assertTask(a: Dict): void {
    if (!pyEq(get(a, 'task_id'), this.task.task_id)) throw valueError('write is outside the active task scope')
  }

  /** `_q_filters`. */
  private static qFilters(q: unknown): Map<string, string> {
    const filters = new Map<string, string>()
    if (!truthy(q)) return filters
    for (const clause of reSubject(q).split(/\s+and\s+/i)) {
      const match = /^\s*([A-Za-z_]+)\s*=\s*'?([^']*)'?\s*$/.exec(clause)
      if (match) filters.set(match[1]!, match[2]!)
    }
    return filters
  }

  private filtered(table: string, q: unknown, mapping: Record<string, string>, order: string): Dict[] {
    const clauses = ['tenant_code = ?']
    const values: unknown[] = [this.code]
    for (const [field, value] of World.qFilters(q)) {
      const column = Object.hasOwn(mapping, field) ? mapping[field] : undefined
      if (column) {
        clauses.push(`${column} = ?`)
        values.push(value)
      }
    }
    return this.all(`SELECT * FROM ${table} WHERE ${clauses.join(' AND ')} ORDER BY ${order}`, values)
  }

  dispatch(tool: string, a: Dict): Dict {
    const code = this.code
    const short = this.short
    const model = this.model
    const task = this.task
    switch (tool) {
      case 'erpbench.get_task': {
        if (!pyEq(at(a, 'task_id'), task.task_id)) throw valueError('task not found')
        return {
          task_id: task.task_id,
          prompt: task.prompt,
          tenant_code: code,
          company: task.company,
          as_of: AS_OF,
          answer_schema: task.answer_schema,
          decision_options: (task.decision_options as Dict[]).map((o) => ({ id: o.id, label: o.label })),
          status_options: deepcopy(task.status_options),
          register_contract: deepcopy(task.register_contract),
          allowed_write_tools: task.allowed_write_tools,
          ops_channel: `#ops-${short.toLowerCase()}`,
          handoff:
            'Save one review-only email draft that names the selected decision option id, the primary ERP record number and the key figures; post one handoff to the ops channel that states the decision status id; both stay draft_for_review. Write the register row exactly as the register contract lists its columns, record the decision, then submit the structured answer. Change only the ERP records this request is about.',
        }
      }
      case 'erpbench.get_decision':
        return this.one('SELECT * FROM decisions WHERE task_id = ?', [at(a, 'task_id')])
      case 'erpbench.get_submission':
        return this.one('SELECT * FROM submissions WHERE task_id = ?', [at(a, 'task_id')])
      case 'erpbench.record_decision': {
        this.assertTask(a)
        const decisionId = `DECISION-${str(at(a, 'task_id'))}`
        this.ex('INSERT OR REPLACE INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?)', [
          decisionId,
          at(a, 'task_id'),
          at(a, 'decision'),
          at(a, 'status'),
          at(a, 'primary_record'),
          at(a, 'rationale'),
          json(at(a, 'source_refs')),
        ])
        this.audit(tool, decisionId, a)
        return this.one('SELECT * FROM decisions WHERE decision_id = ?', [decisionId])
      }
      case 'erpbench.submit_answer': {
        this.assertTask(a)
        if (!isDict(at(a, 'answers'))) throw valueError('answers must be an object')
        this.ex('INSERT OR REPLACE INTO submissions VALUES (?, ?)', [at(a, 'task_id'), json(at(a, 'answers'))])
        this.audit(tool, at(a, 'task_id'), a)
        return { task_id: at(a, 'task_id'), answers: at(a, 'answers'), durable: true }
      }

      // ---- Oracle: product master, customers, orders ----
      case 'oracle_fusion.items.list': {
        const rows = this.filtered('items', get(a, 'q'), { OrganizationCode: 'organization_code', ItemNumber: 'item_number', ItemStatusValue: 'item_status' }, 'item_number')
        return {
          items: rows.map((r) => ({
            ItemId: r.item_id,
            ItemNumber: r.item_number,
            ItemDescription: r.description,
            OrganizationCode: r.organization_code,
            PrimaryUOMValue: r.primary_uom,
            ListPrice: r.list_price,
            ItemStatusValue: r.item_status,
            PriceEffectiveDate: r.price_effective_date,
          })),
          count: rows.length,
        }
      }
      case 'oracle_fusion.items.update': {
        this.assertTask(a)
        const item = this.one('SELECT * FROM items WHERE item_id = ? AND tenant_code = ?', [at(a, 'ItemId'), code])
        if (item.item_status !== 'Active') throw valueError('cannot update the price of an inactive item')
        const price = at(a, 'ListPrice')
        if (!isNumber(price) || asNum(price) <= 0) throw valueError('ListPrice must be a positive number')
        this.ex('UPDATE items SET list_price = ?, price_effective_date = ?, last_task_id = ? WHERE item_id = ?', [
          round(toFloat(at(a, 'ListPrice')), 2),
          at(a, 'EffectiveDate'),
          at(a, 'task_id'),
          at(a, 'ItemId'),
        ])
        this.audit(tool, str(at(a, 'ItemId')), a)
        const r = this.one('SELECT * FROM items WHERE item_id = ?', [at(a, 'ItemId')])
        return { ItemId: r.item_id, ItemNumber: r.item_number, ListPrice: r.list_price, PriceEffectiveDate: r.price_effective_date, LastUpdateDate: AS_OF }
      }
      case 'oracle_fusion.customer_account_activities.get': {
        const customer = this.one('SELECT * FROM customers WHERE customer_number = ? AND tenant_code = ?', [at(a, 'AccountId'), code])
        const invoices = this.all('SELECT * FROM receivables_invoices WHERE bill_to_customer_number = ? AND tenant_code = ? ORDER BY due_date', [at(a, 'AccountId'), code])
        const open = invoices.filter((r) => (r.balance_due as PyFloat).v > 0)
        const pastDue = open.filter((r) => (r.due_date as string) < AS_OF_DATE)
        const balances = (rows: Dict[]) => rows.map((r) => (r.balance_due as PyFloat).v)
        return {
          AccountId: customer.customer_number,
          CustomerName: customer.name,
          CreditLimit: customer.credit_limit,
          CreditHoldFlag: truthy(customer.credit_hold),
          PaymentTerms: customer.payment_terms,
          OpenTransactions: open.length,
          OpenReceivablesAmount: round(fsum(balances(open)), 2),
          PastDueAmount: round(fsum(balances(pastDue)), 2),
          AsOfDate: AS_OF_DATE,
        }
      }
      case 'oracle_fusion.sales_orders.list': {
        const rows = this.filtered(
          'sales_orders',
          get(a, 'q'),
          { CustomerPONumber: 'customer_po_number', SourceTransactionSystem: 'source_transaction_system', BuyingPartyNumber: 'buying_party_number', OrderNumber: 'order_number', Status: 'status' },
          'order_number',
        )
        return { items: rows.map((r) => this.orderView(r, false)), count: rows.length }
      }
      case 'oracle_fusion.sales_orders.get':
        return this.orderView(this.one('SELECT * FROM sales_orders WHERE order_number = ? AND tenant_code = ?', [at(a, 'OrderKey'), code]), true)
      case 'oracle_fusion.sales_orders.create': {
        this.assertTask(a)
        const lines = or(get(a, 'lines'), [])
        if (!Array.isArray(lines)) throw valueError('lines must be an array')
        if (lines.length === 0 && get(a, 'OrderTotal') === null) throw valueError('an order needs lines or an OrderTotal')
        let total = new PyFloat(0)
        const normalized: Dict[] = []
        for (const line of lines) {
          const item = this.row('SELECT * FROM items WHERE item_number = ? AND tenant_code = ?', [get(line, 'ProductNumber'), code])
          if (item === null) throw valueError(`unknown item ${str(get(line, 'ProductNumber'))}`)
          if (item.item_status !== 'Active') throw valueError(`item ${str(item.item_number)} is inactive and cannot be ordered`)
          const quantity = pyInt(or(get(line, 'OrderedQuantity'), 0))
          if (quantity <= 0) throw valueError('OrderedQuantity must be positive')
          const price = toFloat(get(line, 'UnitListPrice', item.list_price))
          total = plus(total, times(quantity, price))
          normalized.push({ ProductNumber: item.item_number, OrderedQuantity: quantity, OrderedUOM: get(line, 'OrderedUOM', 'EA'), UnitListPrice: round(price, 2) })
        }
        if (lines.length === 0) total = toFloat(at(a, 'OrderTotal'))
        const existing = this.row('SELECT * FROM sales_orders WHERE source_transaction_number = ? AND source_transaction_system = ? AND tenant_code = ?', [
          at(a, 'SourceTransactionNumber'),
          at(a, 'SourceTransactionSystem'),
          code,
        ])
        if (existing !== null) throw valueError(`source transaction ${str(at(a, 'SourceTransactionNumber'))} already exists as ${str(existing.order_number)}`)
        let orderNumber: string
        if (pyEq(at(a, 'SourceTransactionSystem'), this.world.channel)) {
          const channelRow = this.row('SELECT * FROM channel_orders WHERE channel_order_id = ? AND tenant_code = ? ORDER BY row_id', [at(a, 'SourceTransactionNumber'), code])
          if (channelRow === null) throw valueError('channel order not found in the export')
          const createRows = ((model.channel_order_sync as Dict).rows as Dict[]).filter((r) => r.disposition === 'create')
          const index = createRows.findIndex((r) => pyEq(r.channel_order_id, at(a, 'SourceTransactionNumber')))
          const position = index < 0 ? createRows.length + 1 : index + 1
          orderNumber = `SO-${short}-${52000 + position * 7}`
        } else {
          orderNumber = `SO-${short}-${50000 + pyLen(at(a, 'CustomerPONumber'))}`
          if (this.row('SELECT 1 FROM sales_orders WHERE order_number = ?', [orderNumber])) {
            orderNumber = `${orderNumber}-${this.count('SELECT COUNT(*) FROM sales_orders WHERE last_task_id = ?', [at(a, 'task_id')]) + 1}`
          }
        }
        const status = truthy(at(a, 'SubmittedFlag')) ? 'Booked' : 'Draft'
        const buyerName = get(a, 'BuyingPartyName')
        this.ex('INSERT INTO sales_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          orderNumber,
          code,
          at(a, 'SourceTransactionNumber'),
          at(a, 'SourceTransactionSystem'),
          get(a, 'BuyingPartyNumber'),
          truthy(buyerName) ? buyerName : this.customerName(get(a, 'BuyingPartyNumber')),
          at(a, 'CustomerPONumber'),
          at(a, 'TransactionType'),
          at(a, 'RequestedFulfillmentOrganizationCode'),
          truthy(at(a, 'SubmittedFlag')) ? 1 : 0,
          status,
          round(total, 2),
          json(normalized),
          'analyst',
          `MSG-${str(at(a, 'task_id'))}-REQUEST`,
          AS_OF,
          at(a, 'task_id'),
        ])
        this.audit(tool, orderNumber, a)
        return this.orderView(this.one('SELECT * FROM sales_orders WHERE order_number = ?', [orderNumber]), true)
      }
      case 'oracle_fusion.shipments.list': {
        const rows = this.filtered('shipments', get(a, 'q'), { Shipment: 'shipment', ShipmentStatus: 'shipment_status', OrganizationCode: 'organization_code' }, 'shipment')
        return {
          items: rows.map((r) => ({
            Shipment: r.shipment,
            ShipmentStatus: r.shipment_status,
            OrganizationCode: r.organization_code,
            ShipToCustomer: r.ship_to_customer,
            Order: r.order_number,
            PlannedShipDate: r.planned_ship_date,
          })),
          count: rows.length,
        }
      }
      case 'oracle_fusion.shipment_lines.list': {
        const rows = this.filtered('shipment_lines', get(a, 'q'), { Shipment: 'shipment', Item: 'item_number', LineStatus: 'line_status' }, 'shipment, line_number')
        return { items: rows.map((r) => this.shipmentLineView(r)), count: rows.length }
      }
      case 'oracle_fusion.shipment_lines.update': {
        this.assertTask(a)
        const line = this.one('SELECT * FROM shipment_lines WHERE shipment_line_id = ? AND tenant_code = ?', [at(a, 'ShipmentLine'), code])
        if (line.line_status !== 'Staged') throw valueError('only staged shipment lines can be updated')
        const quantity = pyInt(at(a, 'ShippedQuantity'))
        if (quantity < 0 || quantity > (line.requested_quantity as number)) throw valueError('ShippedQuantity must be between 0 and the requested quantity')
        this.ex('UPDATE shipment_lines SET shipped_quantity = ?, comments = ?, last_task_id = ? WHERE shipment_line_id = ?', [quantity, get(a, 'Comments'), at(a, 'task_id'), at(a, 'ShipmentLine')])
        this.audit(tool, str(at(a, 'ShipmentLine')), a)
        return { ...this.shipmentLineView(this.one('SELECT * FROM shipment_lines WHERE shipment_line_id = ?', [at(a, 'ShipmentLine')])), LastUpdateDate: AS_OF }
      }
      case 'oracle_fusion.receivables_invoices.list': {
        const rows = this.filtered(
          'receivables_invoices',
          get(a, 'q'),
          { BillToCustomerNumber: 'bill_to_customer_number', InvoiceStatus: 'invoice_status', TransactionNumber: 'transaction_number' },
          'due_date',
        )
        return { items: rows.map((r) => this.invoiceView(r)), count: rows.length }
      }
      case 'oracle_fusion.receivables_invoices.get':
        return this.invoiceView(this.one('SELECT * FROM receivables_invoices WHERE customer_transaction_id = ? AND tenant_code = ?', [at(a, 'CustomerTransactionId'), code]))
      case 'oracle_fusion.standard_receipts.list': {
        const rows = this.filtered('standard_receipts', get(a, 'q'), { CustomerAccountNumber: 'customer_account_number', ReceiptNumber: 'receipt_number' }, 'receipt_date')
        return { items: rows.map((r) => this.receiptView(r)), count: rows.length }
      }
      case 'oracle_fusion.standard_receipts.create': {
        this.assertTask(a)
        this.one('SELECT * FROM customers WHERE customer_number = ? AND tenant_code = ?', [at(a, 'CustomerAccountNumber'), code])
        if (this.row('SELECT 1 FROM standard_receipts WHERE receipt_number = ? AND tenant_code = ?', [at(a, 'ReceiptNumber'), code])) {
          throw valueError('receipt number already exists')
        }
        const references = at(a, 'remittanceReferences')
        if (!Array.isArray(references) || references.length === 0) throw valueError('remittanceReferences must list the invoices covered')
        let applied = new PyFloat(0)
        for (const reference of references) {
          const invoice = this.row('SELECT * FROM receivables_invoices WHERE transaction_number = ? AND tenant_code = ?', [get(reference, 'ReferenceNumber'), code])
          if (invoice === null) throw valueError(`unknown invoice ${str(get(reference, 'ReferenceNumber'))}`)
          if (!pyEq(invoice.bill_to_customer_number, at(a, 'CustomerAccountNumber'))) throw valueError('invoice belongs to a different customer account')
          const amount = toFloat(get(reference, 'ApplyAmount', invoice.balance_due))
          if (amount.v <= 0 || amount.v > (invoice.balance_due as PyFloat).v + 0.005) throw valueError('ApplyAmount exceeds the open balance')
          applied = plus(applied, amount)
        }
        if (Math.abs(applied.v - toFloat(at(a, 'ReceiptAmount')).v) > 0.005) throw valueError('applications must equal the receipt amount')
        for (const reference of references as Dict[]) {
          const invoice = this.one('SELECT * FROM receivables_invoices WHERE transaction_number = ? AND tenant_code = ?', [at(reference, 'ReferenceNumber'), code])
          const balance = round(new PyFloat((invoice.balance_due as PyFloat).v - toFloat(get(reference, 'ApplyAmount', invoice.balance_due)).v), 2) as PyFloat
          this.ex('UPDATE receivables_invoices SET balance_due = ?, invoice_status = ?, last_task_id = ? WHERE customer_transaction_id = ?', [
            balance,
            balance.v <= 0.005 ? 'Closed' : 'Open',
            at(a, 'task_id'),
            invoice.customer_transaction_id,
          ])
        }
        const receiptId =
          ((model.receivables_collection as Dict).new_receipt_id as number) + this.count('SELECT COUNT(*) FROM standard_receipts WHERE last_task_id = ?', [at(a, 'task_id')])
        this.ex('INSERT INTO standard_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          receiptId,
          code,
          at(a, 'ReceiptNumber'),
          round(toFloat(at(a, 'ReceiptAmount')), 2),
          at(a, 'ReceiptDate'),
          at(a, 'CustomerAccountNumber'),
          at(a, 'ReceiptMethod'),
          at(a, 'BusinessUnit'),
          at(a, 'Currency'),
          'Applied',
          json(references),
          'analyst',
          at(a, 'task_id'),
        ])
        this.audit(tool, at(a, 'ReceiptNumber'), a)
        return this.receiptView(this.one('SELECT * FROM standard_receipts WHERE standard_receipt_id = ?', [receiptId]))
      }

      // ---- Oracle: inventory and procurement ----
      case 'oracle_fusion.onhand_balances.list': {
        const rows = this.filtered('onhand_balances', get(a, 'q'), { OrganizationCode: 'organization_code', ItemNumber: 'item_number', Subinventory: 'subinventory' }, 'item_number')
        return {
          items: rows.map((r) => ({
            OrganizationCode: r.organization_code,
            ItemNumber: r.item_number,
            Subinventory: r.subinventory,
            OnhandQuantity: r.onhand_quantity,
            ReservedQuantity: r.reserved_quantity,
            AvailableToReserve: (r.onhand_quantity as number) - (r.reserved_quantity as number),
          })),
          count: rows.length,
        }
      }
      case 'oracle_fusion.purchase_orders.list': {
        const rows = this.filtered('purchase_orders', get(a, 'q'), { Supplier: 'supplier', Status: 'status', OrderNumber: 'po_number', SupplierNumber: 'supplier_number' }, 'po_number')
        return { items: rows.map((r) => this.poView(r)), count: rows.length }
      }
      case 'oracle_fusion.purchase_orders.get':
        return this.poView(this.one('SELECT * FROM purchase_orders WHERE po_number = ? AND tenant_code = ?', [at(a, 'purchaseOrdersUniqID'), code]))
      case 'oracle_fusion.purchase_order_lines.list': {
        this.one('SELECT * FROM purchase_orders WHERE po_number = ? AND tenant_code = ?', [at(a, 'purchaseOrdersUniqID'), code])
        const rows = this.all('SELECT * FROM purchase_order_lines WHERE po_number = ? AND tenant_code = ? ORDER BY line_number', [at(a, 'purchaseOrdersUniqID'), code])
        return {
          items: rows.map((r) => ({
            POLineId: r.po_line_id,
            LineNumber: r.line_number,
            Item: r.item_number,
            Quantity: r.quantity,
            UnitPrice: r.unit_price,
            ReceivedQuantity: r.received_quantity,
            PromisedDeliveryDate: r.promised_date,
          })),
          count: rows.length,
        }
      }
      case 'oracle_fusion.suppliers.list': {
        let rows = this.all('SELECT * FROM suppliers WHERE tenant_code = ? ORDER BY supplier_number', [code])
        const numbers = reSubject(or(get(a, 'q'), '')).match(/SUP-[A-Z0-9-]+/g) ?? ([] as string[])
        if (numbers.length > 0) rows = rows.filter((r) => numbers.includes(r.supplier_number as string))
        return {
          items: rows.map((r) => ({
            SupplierId: r.supplier_number,
            SupplierNumber: r.supplier_number,
            Supplier: r.name,
            LeadTimeDays: r.lead_time_days,
            ExpeditePremiumPct: r.expedite_premium_pct,
            Status: r.supplier_status,
          })),
          count: rows.length,
        }
      }
      case 'oracle_fusion.purchase_requisitions.create': {
        this.assertTask(a)
        const lines = at(a, 'lines')
        if (!Array.isArray(lines) || lines.length === 0) throw valueError('a requisition needs at least one line')
        const normalized: Dict[] = []
        let total = new PyFloat(0)
        for (const line of lines) {
          const item = this.row('SELECT * FROM items WHERE item_number = ? AND tenant_code = ?', [get(line, 'ItemNumber'), code])
          if (item === null || item.item_status !== 'Active') throw valueError(`item ${str(get(line, 'ItemNumber'))} cannot be requisitioned`)
          const quantity = pyInt(or(get(line, 'Quantity'), 0))
          if (quantity <= 0) throw valueError('Quantity must be positive')
          const price = round(toFloat(get(line, 'UnitPrice', item.unit_cost)), 2) as PyFloat
          total = plus(total, times(quantity, price))
          normalized.push({
            ItemNumber: item.item_number,
            Quantity: quantity,
            UOM: get(line, 'UOM', 'EA'),
            UnitPrice: price,
            Supplier: get(line, 'Supplier'),
            RequestedDeliveryDate: get(line, 'RequestedDeliveryDate'),
          })
        }
        const reorder = model.inventory_reorder as Dict
        const count = this.count('SELECT COUNT(*) FROM purchase_requisitions WHERE last_task_id = ?', [at(a, 'task_id')])
        const number = count === 0 ? (reorder.requisition_number as string) : `${str(reorder.requisition_number)}-${count + 1}`
        this.ex('INSERT INTO purchase_requisitions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          number,
          (reorder.requisition_id as number) + count,
          code,
          at(a, 'RequisitioningBU'),
          at(a, 'Preparer'),
          at(a, 'Description'),
          at(a, 'Justification'),
          'Incomplete',
          json(normalized),
          round(total, 2),
          'analyst',
          at(a, 'task_id'),
        ])
        this.audit(tool, number, a)
        return this.requisitionView(this.one('SELECT * FROM purchase_requisitions WHERE requisition_number = ?', [number]))
      }
      case 'oracle_fusion.purchase_requisitions.submit': {
        this.assertTask(a)
        const requisition = this.one('SELECT * FROM purchase_requisitions WHERE requisition_number = ? AND tenant_code = ?', [at(a, 'purchaseRequisitionsUniqID'), code])
        if (requisition.document_status !== 'Incomplete') throw valueError('requisition is not in a submittable status')
        this.ex("UPDATE purchase_requisitions SET document_status = 'Pending approval', last_task_id = ? WHERE requisition_number = ?", [
          at(a, 'task_id'),
          at(a, 'purchaseRequisitionsUniqID'),
        ])
        this.audit(tool, at(a, 'purchaseRequisitionsUniqID'), a)
        return this.requisitionView(this.one('SELECT * FROM purchase_requisitions WHERE requisition_number = ?', [at(a, 'purchaseRequisitionsUniqID')]))
      }
      case 'oracle_fusion.purchase_requisitions.get':
        return this.requisitionView(this.one('SELECT * FROM purchase_requisitions WHERE requisition_number = ? AND tenant_code = ?', [at(a, 'purchaseRequisitionsUniqID'), code]))
      case 'oracle_fusion.receiving_receipt_requests.list': {
        const rows = this.filtered('receiving_receipt_requests', get(a, 'q'), { OrganizationCode: 'organization_code', VendorName: 'vendor_name' }, 'header_interface_id')
        return {
          items: rows.map((r) => ({
            HeaderInterfaceId: r.header_interface_id,
            ReceiptSourceCode: r.receipt_source_code,
            OrganizationCode: r.organization_code,
            VendorName: r.vendor_name,
            ProcessingStatusCode: r.processing_status,
            lines: r.lines,
          })),
          count: rows.length,
        }
      }
      case 'oracle_fusion.receiving_receipt_requests.create': {
        this.assertTask(a)
        const lines = at(a, 'lines')
        if (!Array.isArray(lines) || lines.length === 0) throw valueError('a receipt request needs lines')
        const normalized: Dict[] = []
        for (const line of lines) {
          const poLine = this.row('SELECT * FROM purchase_order_lines WHERE po_number = ? AND line_number = ? AND tenant_code = ?', [
            get(line, 'DocumentNumber'),
            get(line, 'DocumentLineNumber'),
            code,
          ])
          if (poLine === null) throw valueError('purchase-order line not found')
          const quantity = pyInt(or(get(line, 'Quantity'), 0))
          if (quantity <= 0 || Number(quantity) + (poLine.received_quantity as number) > (poLine.quantity as number)) {
            throw valueError('received quantity exceeds the open purchase-order quantity')
          }
          this.ex('UPDATE purchase_order_lines SET received_quantity = received_quantity + ?, last_task_id = ? WHERE po_line_id = ?', [quantity, at(a, 'task_id'), poLine.po_line_id])
          normalized.push({
            DocumentNumber: at(line, 'DocumentNumber'),
            DocumentLineNumber: pyInt(at(line, 'DocumentLineNumber')),
            ItemNumber: poLine.item_number,
            Quantity: quantity,
            TransactionType: get(line, 'TransactionType', 'RECEIVE'),
          })
        }
        const count = this.count('SELECT COUNT(*) FROM receiving_receipt_requests WHERE last_task_id = ?', [at(a, 'task_id')])
        const headerId = ((model.receiving_ap_match as Dict).receipt_header_id as number) + count
        this.ex('INSERT INTO receiving_receipt_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          headerId,
          code,
          at(a, 'ReceiptSourceCode'),
          at(a, 'OrganizationCode'),
          get(a, 'VendorName', ''),
          json(normalized),
          'SUCCESS',
          'analyst',
          at(a, 'task_id'),
        ])
        this.audit(tool, str(headerId), a)
        return { HeaderInterfaceId: headerId, ReceiptSourceCode: at(a, 'ReceiptSourceCode'), OrganizationCode: at(a, 'OrganizationCode'), ProcessingStatusCode: 'SUCCESS', lines: normalized }
      }

      // ---- Oracle: payables ----
      case 'oracle_fusion.invoices.list': {
        const rows = this.filtered('ap_invoices', get(a, 'q'), { Supplier: 'supplier', InvoiceNumber: 'invoice_number', BusinessUnit: 'business_unit' }, 'invoice_number')
        return { items: rows.map((r) => this.apInvoiceView(r)), count: rows.length }
      }
      case 'oracle_fusion.invoices.get':
        return this.apInvoiceView(this.one('SELECT * FROM ap_invoices WHERE invoice_number = ? AND tenant_code = ?', [at(a, 'invoicesUniqID'), code]))
      case 'oracle_fusion.invoices.create': {
        this.assertTask(a)
        if (this.row('SELECT 1 FROM ap_invoices WHERE invoice_number = ? AND supplier = ? AND tenant_code = ?', [at(a, 'InvoiceNumber'), at(a, 'Supplier'), code])) {
          throw valueError('invoice already exists for this supplier')
        }
        const lines = at(a, 'invoiceLines')
        if (!Array.isArray(lines) || lines.length === 0) throw valueError('an invoice needs lines')
        const normalized: Dict[] = []
        let total = new PyFloat(0)
        for (const line of lines) {
          const poLine = this.row('SELECT * FROM purchase_order_lines WHERE po_number = ? AND line_number = ? AND tenant_code = ?', [
            get(line, 'PurchaseOrderNumber'),
            get(line, 'PurchaseOrderLineNumber'),
            code,
          ])
          if (poLine === null) throw valueError('purchase-order line not found for invoice matching')
          const quantity = pyInt(or(get(line, 'Quantity'), 0))
          const price = round(toFloat(or(get(line, 'UnitPrice'), 0)), 2) as PyFloat
          if (quantity <= 0 || price.v <= 0) throw valueError('invoice lines need positive quantity and price')
          total = plus(total, times(quantity, price))
          normalized.push({
            LineNumber: pyInt(get(line, 'LineNumber', normalized.length + 1)),
            PurchaseOrderNumber: at(line, 'PurchaseOrderNumber'),
            PurchaseOrderLineNumber: pyInt(at(line, 'PurchaseOrderLineNumber')),
            ItemNumber: poLine.item_number,
            Quantity: quantity,
            UnitPrice: price,
            ReceivedQuantity: poLine.received_quantity,
            PurchaseOrderPrice: poLine.unit_price,
          })
        }
        if (Math.abs(total.v - toFloat(at(a, 'InvoiceAmount')).v) > 0.005) throw valueError('InvoiceAmount must equal the sum of the lines')
        const count = this.count('SELECT COUNT(*) FROM ap_invoices WHERE last_task_id = ?', [at(a, 'task_id')])
        const invoiceId = ((model.receiving_ap_match as Dict).invoice_id as number) + count
        this.ex('INSERT INTO ap_invoices VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          invoiceId,
          code,
          at(a, 'InvoiceNumber'),
          at(a, 'BusinessUnit'),
          at(a, 'Supplier'),
          round(total, 2),
          at(a, 'InvoiceCurrency'),
          at(a, 'InvoiceDate'),
          'Not validated',
          json(normalized),
          'analyst',
          at(a, 'task_id'),
        ])
        this.audit(tool, at(a, 'InvoiceNumber'), a)
        return this.apInvoiceView(this.one('SELECT * FROM ap_invoices WHERE invoice_id = ?', [invoiceId]))
      }
      case 'oracle_fusion.invoices.validate': {
        this.assertTask(a)
        if (!pyEq(at(a, 'ProcessAction'), 'Validate')) throw valueError('ProcessAction must be Validate')
        const invoice = this.one('SELECT * FROM ap_invoices WHERE invoice_number = ? AND supplier = ? AND tenant_code = ?', [at(a, 'InvoiceNumber'), at(a, 'Supplier'), code])
        const holds = this.all("SELECT * FROM invoice_holds WHERE invoice_id = ? AND hold_status = 'Active'", [invoice.invoice_id])
        const status = holds.length > 0 ? 'Validated with holds' : 'Validated'
        this.ex('UPDATE ap_invoices SET validation_status = ?, last_task_id = ? WHERE invoice_id = ?', [status, at(a, 'task_id'), invoice.invoice_id])
        this.audit(tool, at(a, 'InvoiceNumber'), a)
        return this.apInvoiceView(this.one('SELECT * FROM ap_invoices WHERE invoice_id = ?', [invoice.invoice_id]))
      }
      case 'oracle_fusion.invoice_holds.create': {
        this.assertTask(a)
        const invoice = this.one('SELECT * FROM ap_invoices WHERE invoice_id = ? AND tenant_code = ?', [at(a, 'InvoiceId'), code])
        if (!strip(str(get(a, 'HoldReason', '')))) throw valueError('HoldReason is required')
        const count = this.count('SELECT COUNT(*) FROM invoice_holds WHERE last_task_id = ?', [at(a, 'task_id')])
        const holdId = ((model.receiving_ap_match as Dict).hold_id as number) + count
        this.ex('INSERT INTO invoice_holds VALUES (?, ?, ?, ?, ?, ?, ?)', [holdId, code, invoice.invoice_id, at(a, 'HoldName'), at(a, 'HoldReason'), 'Active', at(a, 'task_id')])
        this.ex("UPDATE ap_invoices SET validation_status = 'On hold', last_task_id = ? WHERE invoice_id = ?", [at(a, 'task_id'), invoice.invoice_id])
        this.audit(tool, str(holdId), a)
        return { HoldId: holdId, InvoiceId: invoice.invoice_id, HoldName: at(a, 'HoldName'), HoldReason: at(a, 'HoldReason'), HoldStatus: 'Active' }
      }

      // ---- Oracle: HCM shaped ----
      case 'oracle_fusion.workers.list': {
        const rows = this.filtered(
          'workers',
          get(a, 'q'),
          { LegalEmployerName: 'legal_employer_name', JobCode: 'job_code', PersonNumber: 'person_number', WorkerStatus: 'worker_status' },
          'person_number',
        )
        return { items: rows.map((r) => this.workerView(r)), count: rows.length }
      }
      case 'oracle_fusion.workers.create': {
        this.assertTask(a)
        if (this.row('SELECT 1 FROM workers WHERE person_number = ? AND tenant_code = ?', [at(a, 'PersonNumber'), code])) throw valueError('person number already exists')
        if (this.row('SELECT 1 FROM workers WHERE candidate_id = ? AND tenant_code = ?', [at(a, 'CandidateId'), code])) throw valueError('candidate already hired')
        if (!pyEq(at(a, 'LegalEmployerName'), this.world.company)) throw valueError('legal employer is outside the active tenant')
        this.ex('INSERT INTO workers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          at(a, 'PersonNumber'),
          code,
          at(a, 'DisplayName'),
          at(a, 'LegalEmployerName'),
          at(a, 'JobCode'),
          at(a, 'HireDate'),
          at(a, 'ContractEndDate'),
          round(toFloat(at(a, 'MonthlySalary')), 2),
          'Active',
          at(a, 'CandidateId'),
          'analyst',
          at(a, 'task_id'),
        ])
        this.audit(tool, at(a, 'PersonNumber'), a)
        return this.workerView(this.one('SELECT * FROM workers WHERE person_number = ?', [at(a, 'PersonNumber')]))
      }
      case 'oracle_fusion.document_records.list': {
        const rows = this.filtered(
          'document_records',
          get(a, 'q'),
          { LegalEmployerName: 'legal_employer_name', PersonNumber: 'person_number', DocumentType: 'document_type', Status: 'status' },
          'document_record_id',
        )
        return { items: rows.map((r) => this.documentView(r)), count: rows.length }
      }
      case 'oracle_fusion.document_records.update': {
        this.assertTask(a)
        const record = this.one('SELECT * FROM document_records WHERE document_record_id = ? AND tenant_code = ?', [at(a, 'DocumentRecordId'), code])
        if (!Object.hasOwn(a, 'Status') && !Object.hasOwn(a, 'VerifiedFlag')) throw valueError('nothing to update')
        const status = get(a, 'Status', record.status)
        let verified = record.verified_flag
        if (get(a, 'VerifiedFlag') === true) {
          if (record.check_outcome === 'fail') throw valueError('a failed mandatory check cannot be marked verified')
          verified = 1
        } else if (get(a, 'VerifiedFlag') === false) verified = 0
        this.ex('UPDATE document_records SET status = ?, verified_flag = ?, check_pending = ?, last_task_id = ? WHERE document_record_id = ?', [
          status,
          verified,
          truthy(verified) ? 0 : record.check_pending,
          at(a, 'task_id'),
          at(a, 'DocumentRecordId'),
        ])
        this.audit(tool, str(at(a, 'DocumentRecordId')), a)
        return { ...this.documentView(this.one('SELECT * FROM document_records WHERE document_record_id = ?', [at(a, 'DocumentRecordId')])), LastUpdateDate: AS_OF }
      }
      case 'oracle_fusion.absences.list': {
        const rows = this.filtered('absences', get(a, 'q'), { employer: 'employer', startDate: 'start_date', personNumber: 'person_number', absenceType: 'absence_type' }, 'absence_id')
        return { items: rows.map((r) => this.absenceView(r)), count: rows.length }
      }
      case 'oracle_fusion.absences.create': {
        this.assertTask(a)
        this.one('SELECT * FROM workers WHERE person_number = ? AND tenant_code = ?', [at(a, 'personNumber'), code])
        if (this.row('SELECT 1 FROM absences WHERE person_number = ? AND start_date = ? AND tenant_code = ?', [at(a, 'personNumber'), at(a, 'startDate'), code])) {
          throw valueError('an absence already exists for this person and date')
        }
        const absenceId = 100 + this.count('SELECT COUNT(*) FROM absences WHERE last_task_id = ?', [at(a, 'task_id')])
        this.ex('INSERT INTO absences VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          absenceId,
          code,
          at(a, 'personNumber'),
          at(a, 'absenceType'),
          at(a, 'startDate'),
          at(a, 'endDate'),
          at(a, 'employer'),
          at(a, 'absenceStatusCd'),
          'analyst',
          at(a, 'task_id'),
        ])
        this.audit(tool, at(a, 'personNumber'), a)
        return this.absenceView(this.one('SELECT * FROM absences WHERE absence_id = ?', [absenceId]))
      }

      // ---- Gmail ----
      case 'gmail.messages.list': {
        const query = at(a, 'q')
        const rows = this.all(
          'SELECT message_id, subject, sender, sent_at, task_id FROM mail_messages WHERE tenant_code = ? AND (subject LIKE ? OR body LIKE ? OR task_id = ?) ORDER BY sent_at DESC',
          [code, `%${str(query)}%`, `%${str(query)}%`, query],
        )
        return {
          messages: rows.map((r) => ({ id: r.message_id, subject: r.subject, from: r.sender, internalDate: r.sent_at, task_id: r.task_id })),
          resultSizeEstimate: rows.length,
        }
      }
      case 'gmail.messages.get': {
        const r = this.one('SELECT * FROM mail_messages WHERE message_id = ? AND tenant_code = ?', [at(a, 'id'), code])
        return { id: r.message_id, subject: r.subject, from: r.sender, to: r.recipients, internalDate: r.sent_at, body: r.body, task_id: r.task_id }
      }
      case 'gmail.drafts.create': {
        this.assertTask(a)
        if (!strip(str(get(a, 'body', ''))) || !strip(str(get(a, 'to', '')))) throw valueError('a draft needs a recipient and a body')
        const draftId = `DRAFT-${str(at(a, 'task_id'))}`
        this.ex('INSERT OR REPLACE INTO mail_drafts VALUES (?, ?, ?, ?, ?, ?, ?)', [draftId, code, at(a, 'task_id'), at(a, 'to'), at(a, 'subject'), at(a, 'body'), 'draft_for_review'])
        this.audit(tool, draftId, a)
        return { id: draftId, message: { to: at(a, 'to'), subject: at(a, 'subject'), labelIds: ['DRAFT'] }, review_status: 'draft_for_review' }
      }
      case 'gmail.drafts.get': {
        const r = this.one('SELECT * FROM mail_drafts WHERE draft_id = ? AND tenant_code = ?', [at(a, 'id'), code])
        return { id: r.draft_id, message: { to: r.recipient, subject: r.subject, body: r.body, labelIds: ['DRAFT'] }, review_status: r.review_status }
      }

      // ---- Drive ----
      case 'google_drive.files.list': {
        const match = /name contains '([^']+)'/.exec(reSubject(at(a, 'q')))
        let rows = this.all('SELECT * FROM drive_files WHERE tenant_code = ? ORDER BY name', [code])
        if (match) {
          const needle = match[1]!.toLowerCase()
          rows = rows.filter((r) => [r.name, r.logical_name, r.content].some((s) => (s as string).toLowerCase().includes(needle)))
        }
        return {
          files: rows.map((r) => ({
            id: r.file_id,
            name: r.name,
            mimeType: r.mime_type,
            version: r.version,
            isCurrentAuthority: truthy(r.is_current),
            modifiedTime: r.modified_time,
          })),
        }
      }
      case 'google_drive.files.get': {
        const r = this.one('SELECT * FROM drive_files WHERE file_id = ? AND tenant_code = ?', [at(a, 'fileId'), code])
        return {
          id: r.file_id,
          name: r.name,
          mimeType: r.mime_type,
          version: r.version,
          isCurrentAuthority: truthy(r.is_current),
          modifiedTime: r.modified_time,
          size: Buffer.byteLength(r.content as string, 'utf8'),
        }
      }
      case 'google_drive.files.download': {
        const r = this.one('SELECT * FROM drive_files WHERE file_id = ? AND tenant_code = ?', [at(a, 'fileId'), code])
        return { id: r.file_id, name: r.name, mimeType: r.mime_type, isCurrentAuthority: truthy(r.is_current), content: r.content }
      }

      // ---- Sheets ----
      case 'google_sheets.spreadsheets.values.get': {
        const sheet = this.one('SELECT * FROM spreadsheets WHERE spreadsheet_id = ? AND tenant_code = ?', [at(a, 'spreadsheetId'), code])
        return { spreadsheetId: at(a, 'spreadsheetId'), range: at(a, 'range'), values: lookup(sheet.ranges as Dict, at(a, 'range')) }
      }
      case 'google_sheets.spreadsheets.values.update':
      case 'google_sheets.spreadsheets.values.append': {
        this.assertTask(a)
        const sheet = this.one('SELECT * FROM spreadsheets WHERE spreadsheet_id = ? AND tenant_code = ?', [at(a, 'spreadsheetId'), code])
        const values = at(a, 'values')
        if (!Array.isArray(values) || values.length === 0 || !values.every((r) => Array.isArray(r))) throw valueError('values must be a two-dimensional array')
        const ranges = sheet.ranges as Dict
        const operation = tool.endsWith('update') ? 'update' : 'append'
        if (operation === 'update') store(ranges, at(a, 'range'), values)
        else {
          const before = lookup(ranges, at(a, 'range'))
          store(ranges, at(a, 'range'), [...(truthy(before) ? (before as unknown[]) : []), ...values])
        }
        this.ex('UPDATE spreadsheets SET ranges_json = ? WHERE spreadsheet_id = ?', [json(ranges), at(a, 'spreadsheetId')])
        const count = this.count('SELECT COUNT(*) FROM sheet_changes WHERE task_id = ?', [at(a, 'task_id')])
        const changeId = `CHANGE-${str(at(a, 'task_id'))}-${count + 1}`
        this.ex('INSERT INTO sheet_changes VALUES (?, ?, ?, ?, ?, ?, ?)', [changeId, code, at(a, 'spreadsheetId'), at(a, 'task_id'), at(a, 'range'), operation, json(values)])
        this.audit(tool, at(a, 'spreadsheetId'), a)
        return { spreadsheetId: at(a, 'spreadsheetId'), updatedRange: at(a, 'range'), updatedRows: values.length, changeId }
      }

      // ---- Slack ----
      case 'slack.conversations_history': {
        const messages = this.all('SELECT * FROM chat_messages WHERE channel = ? AND tenant_code = ? ORDER BY posted_at', [at(a, 'channel'), code])
        const byTask = truthy(get(a, 'task_id'))
        const posts = this.all(`SELECT * FROM chat_posts WHERE channel = ? AND tenant_code = ?${byTask ? ' AND task_id = ?' : ''} ORDER BY post_id`, [
          at(a, 'channel'),
          code,
          ...(byTask ? [at(a, 'task_id')] : []),
        ])
        return {
          ok: true,
          channel: at(a, 'channel'),
          messages: [
            ...messages.map((r) => ({ ts: r.posted_at, user: r.author, text: r.text, thread_ts: r.thread_id })),
            ...posts.map((r) => ({ ts: AS_OF, user: 'analyst', text: r.text, review_status: r.review_status, task_id: r.task_id })),
          ],
        }
      }
      case 'slack.search_messages': {
        const needle = lowerOf(at(a, 'query'))
        const rows = this.all('SELECT * FROM chat_messages WHERE tenant_code = ? ORDER BY posted_at', [code])
        const matches = rows.filter((r) => (r.text as string).toLowerCase().includes(needle) || (r.channel as string).toLowerCase().includes(needle))
        return {
          ok: true,
          query: at(a, 'query'),
          messages: { total: matches.length, matches: matches.map((r) => ({ channel: r.channel, user: r.author, text: r.text, ts: r.posted_at })) },
        }
      }
      case 'slack.chat_postMessage': {
        this.assertTask(a)
        if (!pyEq(at(a, 'review_status'), 'draft_for_review')) throw valueError('handoff must remain draft_for_review')
        if (!strip(str(get(a, 'text', '')))) throw valueError('text is required')
        const postId = `POST-${str(at(a, 'task_id'))}`
        this.ex('INSERT OR REPLACE INTO chat_posts VALUES (?, ?, ?, ?, ?, ?)', [postId, code, at(a, 'channel'), at(a, 'task_id'), at(a, 'text'), at(a, 'review_status')])
        this.audit(tool, postId, a)
        return { ok: true, channel: at(a, 'channel'), ts: AS_OF, message: { text: at(a, 'text'), review_status: at(a, 'review_status') } }
      }
    }
    throw valueError(`unimplemented tool: ${tool}`)
  }

  private customerName(number: unknown): string {
    if (!truthy(number)) return ''
    const r = this.row('SELECT name FROM customers WHERE customer_number = ?', [number])
    return r ? (r.name as string) : ''
  }

  private orderView(r: Dict, withLines: boolean): Dict {
    const view: Dict = {
      OrderNumber: r.order_number,
      OrderKey: r.order_number,
      SourceTransactionNumber: r.source_transaction_number,
      SourceTransactionSystem: r.source_transaction_system,
      BuyingPartyNumber: r.buying_party_number,
      BuyingPartyName: r.buying_party_name,
      CustomerPONumber: r.customer_po_number,
      TransactionType: r.transaction_type,
      RequestedFulfillmentOrganizationCode: r.organization_code,
      SubmittedFlag: truthy(r.submitted_flag),
      StatusCode: r.status,
      OrderTotal: r.order_total,
      CreatedBy: r.created_by,
      CreationDate: r.created_at,
      LastUpdateDate: truthy(r.last_task_id) ? AS_OF : r.created_at,
    }
    if (withLines) view.lines = r.lines
    else view.lineCount = pyLen(r.lines)
    return view
  }

  private shipmentLineView(r: Dict): Dict {
    return {
      ShipmentLine: r.shipment_line_id,
      Shipment: r.shipment,
      LineNumber: r.line_number,
      Item: r.item_number,
      RequestedQuantity: r.requested_quantity,
      ShippedQuantity: r.shipped_quantity,
      UnitPrice: r.unit_price,
      LineStatus: r.line_status,
      Comments: r.comments,
    }
  }

  private invoiceView(r: Dict): Dict {
    return {
      CustomerTransactionId: r.customer_transaction_id,
      TransactionNumber: r.transaction_number,
      BillToCustomerNumber: r.bill_to_customer_number,
      EnteredAmount: r.entered_amount,
      BalanceDue: r.balance_due,
      TransactionDate: r.transaction_date,
      DueDate: r.due_date,
      InvoiceStatus: r.invoice_status,
    }
  }

  private receiptView(r: Dict): Dict {
    return {
      StandardReceiptId: r.standard_receipt_id,
      ReceiptNumber: r.receipt_number,
      ReceiptAmount: r.receipt_amount,
      ReceiptDate: r.receipt_date,
      CustomerAccountNumber: r.customer_account_number,
      ReceiptMethod: r.receipt_method,
      BusinessUnit: r.business_unit,
      Currency: r.currency,
      Status: r.receipt_status,
      remittanceReferences: r.remittance_references,
    }
  }

  private poView(r: Dict): Dict {
    return {
      POHeaderId: r.po_id,
      OrderNumber: r.po_number,
      Supplier: r.supplier,
      SupplierNumber: r.supplier_number,
      Status: r.status,
      OrderDate: r.order_date,
      Total: r.total_amount,
      Buyer: r.buyer,
    }
  }

  private requisitionView(r: Dict): Dict {
    return {
      RequisitionHeaderId: r.requisition_id,
      Requisition: r.requisition_number,
      RequisitioningBU: r.requisitioning_bu,
      Preparer: r.preparer,
      Description: r.description,
      Justification: r.justification,
      DocumentStatus: r.document_status,
      TotalAmount: r.total_amount,
      lines: r.lines,
      LastUpdateDate: AS_OF,
    }
  }

  private apInvoiceView(r: Dict): Dict {
    const holds = this.all('SELECT * FROM invoice_holds WHERE invoice_id = ? ORDER BY hold_id', [r.invoice_id])
    return {
      InvoiceId: r.invoice_id,
      InvoiceNumber: r.invoice_number,
      BusinessUnit: r.business_unit,
      Supplier: r.supplier,
      InvoiceAmount: r.invoice_amount,
      InvoiceCurrency: r.invoice_currency,
      InvoiceDate: r.invoice_date,
      ValidationStatus: r.validation_status,
      invoiceLines: r.lines,
      invoiceHolds: holds.map((h) => ({ HoldId: h.hold_id, HoldName: h.hold_name, HoldReason: h.hold_reason, HoldStatus: h.hold_status })),
      LastUpdateDate: AS_OF,
    }
  }

  private workerView(r: Dict): Dict {
    return {
      PersonNumber: r.person_number,
      DisplayName: r.display_name,
      LegalEmployerName: r.legal_employer_name,
      JobCode: r.job_code,
      HireDate: r.hire_date,
      ContractEndDate: r.contract_end_date,
      MonthlySalary: r.monthly_salary,
      WorkerStatus: r.worker_status,
      CandidateId: r.candidate_id,
    }
  }

  private documentView(r: Dict): Dict {
    return {
      DocumentRecordId: r.document_record_id,
      PersonNumber: r.person_number,
      DocumentType: r.document_type,
      DateTo: r.date_to,
      Status: r.status,
      VerifiedFlag: truthy(r.verified_flag),
      MandatoryCheckOutcome: r.check_outcome,
      CheckPending: truthy(r.check_pending),
      LegalEmployerName: r.legal_employer_name,
    }
  }

  private absenceView(r: Dict): Dict {
    return {
      absenceId: r.absence_id,
      personNumber: r.person_number,
      absenceType: r.absence_type,
      startDate: r.start_date,
      endDate: r.end_date,
      employer: r.employer,
      absenceStatusCd: r.absence_status,
    }
  }
}
