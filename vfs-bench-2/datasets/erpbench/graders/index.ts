/**
 * ERPBench-100's grader, native: a port of upstream's tests/verify.py and
 * the `score_episode` it calls (erpbench100/evaluation.py, with spec.py's
 * register row; blobfishai/erp-agent-simulation 5bdf458, Apache-2.0),
 * statement for statement.
 *
 * Upstream scores the world as seeded, the world at the end and the call
 * trace. The fake hands the grader all three through its private state view
 * (`baseline`, `snapshot`, `trace`, and the task's world model, `model`),
 * each as `json.dumps` text, so a float stays a `PyFloat` here (`NaN` too); the task
 * (expected answers, rubric) is its `tests/task.json`. Upstream's scoring
 * constants come from the generator (manifest.json).
 *
 * The comparisons are Python's: `5.0 == 5`, `True == 1`, sets of tuples
 * equal by hash, `round` half to even on the exact value, `str` and
 * `format` of a float as Python prints it, and the TypeError, KeyError and
 * AttributeError upstream would raise, which fail the grade as the
 * reference's crash does.
 */
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
import { PyDict, PyFloat, fixed, pyEq, pyIter, pyKey, pyLen, round, str, strip, toFloat, truthy } from '../../../workspace/py.ts'
import { Context, type Grade, type Grader, type InputSpec, type Row } from '../../../workspace/grader.ts'
import { PyError } from '../../complexmcp/mocks/complexmcp/common.ts'
import { asNum, at, dumps, get, isDict, pyInt, pyLoads, typeError } from '../mocks/erpbench/py.ts'
import MANIFEST from './manifest.json' with { type: 'json' }

type Snapshot = Row
type Entry = Row

const C = MANIFEST.constants
const WRITE_TOOLS = new Set(C.write_tools)
const FAMILY_WRITE_TABLES: Record<string, string[]> = C.family_write_tables
const NUMERIC_FIELDS: Record<string, string[]> = C.numeric_fields

/** `x[key]` on a value the agent wrote: a dict's KeyError, or the TypeError of indexing a str. */
function index(x: unknown, key: string): any {
  if (!isDict(x)) throw typeError(`'${typeof x === 'string' ? 'str' : 'object'}' object is not subscriptable`)
  return at(x, key)
}

/** `x.startswith(prefix)`, and the AttributeError a non-str raises. */
function startswith(x: unknown, prefix: string): boolean {
  if (typeof x !== 'string') throw new PyError(`object has no attribute 'startswith'`)
  return x.startsWith(prefix)
}

/** `x in container` for a str, list or dict, and the TypeError of anything else. */
function contains(container: unknown, x: unknown): boolean {
  if (typeof container === 'string') {
    if (typeof x !== 'string') throw typeError("'in <string>' requires string as left operand")
    return container.includes(x)
  }
  if (Array.isArray(container)) return container.some((y) => pyEq(x, y))
  if (isDict(container)) return typeof x === 'string' && Object.hasOwn(container, x)
  throw typeError('argument of type is not iterable')
}

/** A tuple's key in a Python set: equal by its elements' hashes. */
const tupleKey = (t: unknown[]) => t.map((x) => pyKey(x, 'set element')).join('\u0000')
const setOf = (xs: Iterable<unknown>) => new Set([...xs].map((x) => pyKey(x, 'set element')))
const tupleSet = (ts: Iterable<unknown[]>) => new Set([...ts].map(tupleKey))
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k))
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k))

/** `f"{x:,}"`: the int part of `str(x)` grouped by thousands. */
const grouped = (x: unknown) => str(x).replace(/^(-?)(\d+)/, (_, sign, digits) => sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','))

/** `_canonical`: `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. */
const canonical = (v: unknown) => dumps(v, true)

/** `_equal`: a bool as `is`/`==`, a number within 0.005 of `float(actual)`, else `==`. */
function equal(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'boolean') return actual === expected || pyEq(actual, expected)
  if (typeof expected === 'number' || typeof expected === 'bigint' || expected instanceof PyFloat) {
    let a: number
    try {
      a = toFloat(actual).v
    } catch (error) {
      if (error instanceof PyError) return false
      throw error
    }
    return Math.abs(a - asNum(expected)) <= 0.005
  }
  return pyEq(actual, expected)
}

const successful = (trace: Entry[], tool: string) => trace.filter((e) => truthy(get(e, 'success')) && pyEq(get(e, 'tool'), tool))

function callMatches(entry: Entry, requirement: Row): boolean {
  if (!pyEq(get(entry, 'tool'), get(requirement, 'tool')) || !truthy(get(entry, 'success'))) return false
  if (Object.hasOwn(requirement, 'arguments')) return canonical(get(entry, 'arguments', {})) === canonical(requirement.arguments)
  const actual = get(entry, 'arguments', {})
  const args = truthy(actual) ? actual : {}
  const wanted = get(requirement, 'arguments_contains')
  for (const [key, fragment] of Object.entries((truthy(wanted) ? wanted : {}) as Row)) {
    const value = get(args, key)
    if (value === null) return false
    const haystack = typeof value === 'string' ? value : canonical(value)
    if (!haystack.toLowerCase().includes(str(fragment).toLowerCase())) return false
  }
  return true
}

function readAfter(trace: Entry[], readTool: string, writeTool: string): boolean {
  const writes = successful(trace, writeTool).map((e) => asNum(e.index))
  if (!writes.length) return false
  const first = Math.min(...writes)
  return successful(trace, readTool).some((e) => asNum(e.index) > first)
}

const table = (s: Snapshot, name: string) => get(s, name, []) as Row[]
const matches = (row: Row, match: Row) => Object.entries(match).every(([k, v]) => pyEq(get(row, k), v))
const one = (s: Snapshot, name: string, match: Row): Row | null => table(s, name).find((row) => matches(row, match)) ?? null
const many = (s: Snapshot, name: string, match: Row) => table(s, name).filter((row) => matches(row, match))
const sameRow = (before: Snapshot, after: Snapshot, name: string, key: string, value: unknown) =>
  pyEq(one(before, name, { [key]: value }), one(after, name, { [key]: value }))

/** `_line_set`: each line's fields as a tuple, a number rounded to cents. */
function lineSet(lines: unknown, ...fields: string[]): Set<string> {
  return tupleSet(
    pyIter(lines).map((line) =>
      fields.map((field) => {
        const v = get(line, field)
        const number = typeof v === 'number' || typeof v === 'bigint' || v instanceof PyFloat
        return number ? round(toFloat(v), 2) : v
      })
    )
  )
}

interface State {
  primary: boolean
  secondary: boolean
  forbidden: boolean
  unrelated: boolean
}

/** `_erp_state`: the family's primary/secondary/forbidden/unrelated verdicts. */
function erpState(task: Row, model: Row, before: Snapshot, after: Snapshot): State {
  const taskId = task.task_id
  const category: string = task.metadata.category
  const world = model.world
  const section = model[category]
  const customer = world.customer
  const s: State = { primary: false, secondary: false, forbidden: false, unrelated: true }
  const mine = { last_task_id: taskId }

  if (category === 'order_import') {
    const created = many(after, 'sales_orders', mine)
    const expected = lineSet(
      section.lines
        .filter((l: Row) => pyEq(l.disposition, 'accepted'))
        .map((l: Row) => ({ ProductNumber: l.item_number, OrderedQuantity: l.quantity, UnitListPrice: l.list_price })),
      'ProductNumber',
      'OrderedQuantity',
      'UnitListPrice'
    )
    const order = created.length === 1 ? created[0]! : null
    s.primary = Boolean(
      order &&
        pyEq(order.customer_po_number, customer.po) &&
        pyEq(order.source_transaction_number, section.batch_file_id) &&
        pyEq(order.buying_party_number, customer.number) &&
        sameSet(lineSet(order.lines, 'ProductNumber', 'OrderedQuantity', 'UnitListPrice'), expected) &&
        equal(order.order_total, section.order_total)
    )
    s.secondary = Boolean(order && truthy(order.submitted_flag) === !truthy(section.credit_hold) && pyEq(order.source_transaction_system, 'OPS'))
    const prior = tupleSet(section.lines.filter((l: Row) => truthy(l.previously_imported)).map((l: Row) => [l.item_number, l.quantity]))
    s.forbidden =
      created.length > 1 ||
      created.some((row) => pyIter(row.lines).some((line) => prior.has(tupleKey([index(line, 'ProductNumber'), index(line, 'OrderedQuantity')]))))
    s.unrelated =
      sameRow(before, after, 'sales_orders', 'order_number', section.prior_order_number) &&
      sameRow(before, after, 'sales_orders', 'order_number', `SO-${world.short}-DECOY`)
  } else if (category === 'shipment_verification') {
    const correctedOk: boolean[] = []
    let touched = false
    for (const line of section.lines) {
      const row = one(after, 'shipment_lines', { shipment_line_id: line.shipment_line_id })
      if (pyEq(line.disposition, 'corrected')) correctedOk.push(Boolean(row && pyEq(row.shipped_quantity, line.picked) && pyEq(row.last_task_id, taskId)))
      else if (!sameRow(before, after, 'shipment_lines', 'shipment_line_id', line.shipment_line_id)) touched = true
    }
    const decoySame = sameRow(before, after, 'shipment_lines', 'shipment_line_id', 700000 + pyLen(world.short))
    const commented = section.lines
      .filter((line: Row) => pyEq(line.disposition, 'corrected'))
      .map((line: Row) => {
        const row = one(after, 'shipment_lines', { shipment_line_id: line.shipment_line_id })
        if (!row || !pyEq(row.last_task_id, taskId)) return false
        const comments = get(row, 'comments')
        return strip(str(truthy(comments) ? comments : '')) !== ''
      })
    s.primary = correctedOk.length > 0 && correctedOk.every(Boolean)
    s.secondary = commented.length > 0 && commented.every(Boolean) && !touched && decoySame
    s.forbidden = touched || !decoySame
    s.unrelated = decoySame
  } else if (category === 'receivables_collection') {
    const receipts = many(after, 'standard_receipts', mine)
    const receipt = receipts.length === 1 ? receipts[0]! : null
    const expectedRefs = tupleSet(
      section.covered_invoices.map((number: unknown) => {
        const invoice = section.invoices.find((row: Row) => pyEq(row.transaction_number, number))
        if (invoice === undefined) throw new PyError('StopIteration')
        return [number, round(invoice.amount, 2)]
      })
    )
    const actualRefs = tupleSet(
      pyIter(receipt ? receipt.remittance_references : []).map((ref) => [get(ref, 'ReferenceNumber'), round(toFloat(get(ref, 'ApplyAmount', 0)), 2)])
    )
    s.primary = Boolean(
      receipt &&
        pyEq(receipt.receipt_number, section.receipt_number) &&
        equal(receipt.receipt_amount, section.receipt_amount) &&
        pyEq(receipt.customer_account_number, customer.number) &&
        pyEq(receipt.receipt_date, section.receipt_date) &&
        sameSet(actualRefs, expectedRefs)
    )
    const coveredClosed = section.covered_invoices.every((number: unknown) => {
      const row = one(after, 'receivables_invoices', { transaction_number: number })
      return row !== null && equal(row.balance_due, 0) && pyEq(row.invoice_status, 'Closed')
    })
    const uncoveredSame = section.invoices
      .filter((row: Row) => !truthy(row.covered))
      .every((row: Row) => sameRow(before, after, 'receivables_invoices', 'transaction_number', row.transaction_number))
    s.secondary = coveredClosed && uncoveredSame
    s.forbidden = receipts.length > 1 || !uncoveredSame
    s.unrelated = sameRow(before, after, 'receivables_invoices', 'transaction_number', `INV-${world.short}-DECOY`)
  } else if (category === 'inventory_reorder') {
    const requisitions = many(after, 'purchase_requisitions', mine)
    const requisition = requisitions.length === 1 ? requisitions[0]! : null
    const below = section.skus.filter((sku: Row) => truthy(sku.below))
    const expected = tupleSet(below.map((sku: Row) => [sku.item_number, sku.reorder_qty, round(sku.unit_cost, 2)]))
    const actual = requisition ? lineSet(requisition.lines, 'ItemNumber', 'Quantity', 'UnitPrice') : new Set<string>()
    const supplierOk = Boolean(requisition) && pyIter(requisition!.lines).every((line) => pyEq(get(line, 'Supplier'), world.supplier.name))
    s.primary = Boolean(requisition && sameSet(actual, expected) && equal(requisition.total_amount, section.requisition_amount) && supplierOk)
    s.secondary = Boolean(requisition && pyEq(requisition.document_status, 'Pending approval'))
    const belowItems = setOf(below.map((sku: Row) => sku.item_number))
    s.forbidden =
      requisitions.length > 1 ||
      requisitions.some((row) =>
        pyIter(row.lines).some((line) => !belowItems.has(pyKey(get(line, 'ItemNumber'), 'set element')) || pyEq(get(line, 'Supplier'), world.expedite_supplier.name))
      )
  } else if (category === 'receiving_ap_match') {
    const receipts = many(after, 'receiving_receipt_requests', mine)
    const received = tupleSet(
      receipts.flatMap((row) => pyIter(row.lines).map((line) => [get(line, 'DocumentNumber'), pyInt(get(line, 'DocumentLineNumber')), pyInt(get(line, 'Quantity'))]))
    )
    const expectedReceived = tupleSet(section.lines.map((line: Row) => [section.po, line.line, line.received]))
    const invoices = many(after, 'ap_invoices', mine)
    const invoice = invoices.find((row) => pyEq(row.invoice_number, section.invoice_number)) ?? null
    const expectedLines = tupleSet(section.lines.map((line: Row) => [line.line, line.invoiced_qty, round(line.invoice_price, 2)]))
    const actualLines = invoice ? lineSet(invoice.lines, 'PurchaseOrderLineNumber', 'Quantity', 'UnitPrice') : new Set<string>()
    s.primary = Boolean(
      sameSet(received, expectedReceived) &&
        invoice &&
        equal(invoice.invoice_amount, section.invoice_total) &&
        sameSet(actualLines, expectedLines) &&
        pyEq(invoice.supplier, world.supplier.name)
    )
    const holds = invoice ? many(after, 'invoice_holds', { invoice_id: invoice.invoice_id }) : []
    if (truthy(section.held_lines)) {
      const held = section.lines.filter((line: Row) => !truthy(line.matched)).map((line: Row) => str(line.line))
      s.secondary = Boolean(
        invoice &&
          pyEq(invoice.validation_status, 'On hold') &&
          holds.length > 0 &&
          held.every((number: string) => holds.some((hold) => contains(hold.hold_reason, `line ${number}`)))
      )
      s.forbidden = Boolean(invoice && startswith(invoice.validation_status, 'Validated'))
    } else {
      s.secondary = Boolean(invoice && pyEq(invoice.validation_status, 'Validated') && holds.length === 0)
      s.forbidden = holds.length > 0
    }
    s.forbidden = s.forbidden || invoices.length > 1
    s.unrelated = sameRow(before, after, 'purchase_orders', 'po_number', `PO-${world.short}-CLOSED`)
  } else if (category === 'document_compliance') {
    const alertOk: boolean[] = []
    const verifyOk: boolean[] = []
    let forbidden = false
    for (const doc of section.documents) {
      const row = one(after, 'document_records', { document_record_id: doc.document_record_id })
      if (row === null) {
        alertOk.push(false)
        continue
      }
      if (truthy(doc.needs_alert)) alertOk.push(pyEq(row.status, 'ALERTED') && pyEq(row.last_task_id, taskId))
      else if (!truthy(doc.alerted) && pyEq(row.status, 'ALERTED')) forbidden = true
      if (truthy(doc.check_pending) && !truthy(doc.blocked)) verifyOk.push(truthy(row.verified_flag) && pyEq(row.last_task_id, taskId))
      else if (truthy(row.verified_flag)) forbidden = true
    }
    s.primary = alertOk.length > 0 && alertOk.every(Boolean)
    s.secondary = verifyOk.length > 0 && verifyOk.every(Boolean) && !forbidden
    s.forbidden = forbidden
  } else if (category === 'shift_rollup') {
    const created = many(after, 'absences', mine)
    const people = setOf(created.map((row) => row.person_number))
    const missing = setOf(section.missing)
    s.primary =
      created.length > 0 &&
      sameSet(people, missing) &&
      created.every(
        (row) => pyEq(row.absence_type, 'Unauthorized absence') && pyEq(row.start_date, section.shift_date) && pyEq(row.end_date, section.shift_date)
      )
    s.secondary =
      created.length > 0 &&
      created.every((row) => pyEq(row.employer, world.company) && pyEq(row.absence_status, 'SUBMITTED')) &&
      created.length === section.missing.length
    s.forbidden = minus(people, missing).length > 0
    s.unrelated = section.approved_absent.every((code: unknown) => sameRow(before, after, 'absences', 'person_number', code))
  } else if (category === 'channel_order_sync') {
    const created = many(after, 'sales_orders', mine)
    const expected = PyDict.from<Row>(section.rows.filter((row: Row) => pyEq(row.disposition, 'create')).map((row: Row) => [row.channel_order_id, row]))
    const bySource = PyDict.from<Row>(created.map((row) => [row.source_transaction_number, row]))
    const sources = setOf(bySource.keys())
    const wanted = setOf(expected.keys())
    s.primary =
      sameSet(sources, wanted) &&
      bySource
        .entries()
        .every(
          ([source, row]) =>
            pyEq(row.source_transaction_system, world.channel) && equal(row.order_total, expected.get(source)!.total) && truthy(row.submitted_flag)
        )
    const appended = many(after, 'sheet_changes', { task_id: taskId }).filter(
      (change) => pyEq(change.operation, 'append') && startswith(change.cell_range, 'Customers!')
    )
    const customer = section.new_customer
    const needles = [customer.name, customer.tax_id, customer.email]
    s.secondary = appended.some((change) =>
      pyIter(change.values).some((row) => needles.every((needle) => pyIter(row).some((cell) => contains(str(cell), needle))))
    )
    s.forbidden = minus(sources, wanted).length > 0 || created.length !== expected.size
    s.unrelated = section.rows
      .filter((row: Row) => truthy(row.already_synced))
      .every((row: Row) => sameRow(before, after, 'sales_orders', 'order_number', row.synced_order_number))
  } else if (category === 'hire_against_requisition') {
    const created = many(after, 'workers', mine)
    const expectedIds = setOf(section.hired.map((c: Row) => c.candidate_id))
    const actualIds = setOf(created.map((row) => row.candidate_id))
    s.primary =
      truthy(section.hired) &&
      sameSet(actualIds, expectedIds) &&
      created.every((row) => pyEq(row.job_code, section.job) && pyEq(row.contract_end_date, section.contract_end) && equal(row.monthly_salary, section.wage))
    const eligible = setOf(section.candidates.filter((c: Row) => truthy(c.eligible)).map((c: Row) => c.candidate_id))
    s.secondary =
      created.length > 0 &&
      created.length === asNum(section.hires) &&
      minus(actualIds, eligible).length === 0 &&
      created.length <= asNum(section.open_headcount)
    s.forbidden = minus(actualIds, eligible).length > 0 || created.length > asNum(section.open_headcount)
  } else if (category === 'price_list_batch') {
    const appliedOk: boolean[] = []
    const datedOk: boolean[] = []
    for (const line of section.applied) {
      const row = one(after, 'items', { item_number: line.item_number })
      appliedOk.push(Boolean(row && equal(row.list_price, line.new_price) && pyEq(row.last_task_id, taskId)))
      datedOk.push(Boolean(row && pyEq(row.price_effective_date, line.effective_date) && pyEq(row.last_task_id, taskId)))
    }
    const applied = setOf(section.applied.map((line: Row) => line.item_number))
    const untouched = model.items
      .filter((item: Row) => !applied.has(pyKey(item.item_number, 'set element')))
      .every((item: Row) => sameRow(before, after, 'items', 'item_number', item.item_number))
    s.primary = appliedOk.length > 0 && appliedOk.every(Boolean)
    s.secondary = datedOk.length > 0 && datedOk.every(Boolean) && untouched
    s.forbidden = !untouched
    s.unrelated = untouched
  } else throw new PyError(`'${category}'`)
  return s
}

/** `score_episode`: every rubric criterion's verdict, and the reward. */
export function scoreEpisode(task: Row, model: Row, before: Snapshot, after: Snapshot, trace: Entry[]): Grade {
  const expected = task.expected_answer
  const taskId = task.task_id
  const category: string = task.metadata.category
  const world = model.world
  const results = new Map<string, boolean>()

  const writes = trace.filter((e) => truthy(get(e, 'success')) && WRITE_TOOLS.has(get(e, 'tool') as string)).map((e) => asNum(e.index))
  const firstWrite = writes.length ? Math.min(...writes) : 10 ** 9
  for (const investigation of task.required_investigations)
    results.set(
      `discovery:${investigation.id}`,
      investigation.any_of.some((requirement: Row) => trace.some((entry) => asNum(entry.index) < firstWrite && callMatches(entry, requirement)))
    )

  const submission = one(after, 'submissions', { task_id: taskId })
  let answers = submission ? get(submission, 'answers', {}) : {}
  if (!isDict(answers)) answers = {}
  const given = answers as Row
  for (const field of NUMERIC_FIELDS[category]!) results.set(`calculation:${field}`, Object.hasOwn(given, field) && equal(given[field], expected[field]))
  results.set('decision:recommended_option', pyEq(get(given, 'recommended_option'), expected.recommended_option))
  results.set('decision:operative_source', pyEq(get(given, 'source_reference'), expected.source_reference))

  const state = erpState(task, model, before, after)
  results.set('erp_state:primary_write', state.primary)
  results.set('erp_state:secondary_write', state.secondary && !state.forbidden)

  const row = 20 + (Number(String(taskId).split('-').at(-1)) % 10)
  const range = `Register!A${row}:H${row}`
  const expectedRow = [expected.primary_record, expected.recommended_option, ...NUMERIC_FIELDS[category]!.map((f) => expected[f]), expected.source_reference]
  const registerChanges = many(after, 'sheet_changes', { task_id: taskId }).filter(
    (change) =>
      pyEq(change.spreadsheet_id, task.register_contract.spreadsheetId) &&
      ((pyEq(change.operation, 'update') && pyEq(change.cell_range, range)) ||
        (pyEq(change.operation, 'append') && startswith(change.cell_range, 'Register')))
  )
  results.set(
    'erp_state:register',
    registerChanges.some((change) =>
      pyIter(change.values).some((values) => {
        if (pyLen(values) < expectedRow.length) return false
        const cells = pyIter(values).slice(0, expectedRow.length)
        return cells.every((actual, i) => equal(actual, expectedRow[i]))
      })
    )
  )

  const decision = one(after, 'decisions', { task_id: taskId })
  results.set(
    'erp_state:decision_record',
    Boolean(
      decision &&
        pyEq(decision.decision, expected.recommended_option) &&
        pyEq(decision.status, expected.decision_status) &&
        pyEq(decision.primary_record, expected.primary_record) &&
        contains(get(decision, 'source_refs', []), expected.source_reference)
    )
  )

  const draft = one(after, 'mail_drafts', { task_id: taskId })
  const body: string = draft ? draft.body : ''
  const mentions = NUMERIC_FIELDS[category]!.filter((field) => {
    const v = expected[field]
    return body.includes(str(v)) || body.includes(fixed(v, 2)) || body.includes(grouped(v))
  }).length
  const option = task.decision_options.find((o: Row) => pyEq(o.id, expected.recommended_option))
  if (option === undefined) throw new PyError('StopIteration')
  const optionNamed = body.toLowerCase().includes(expected.recommended_option.toLowerCase()) || body.toLowerCase().includes(option.label.toLowerCase())
  results.set(
    'handoff:email_draft',
    Boolean(draft && pyEq(draft.review_status, 'draft_for_review') && optionNamed && body.includes(expected.primary_record) && mentions >= 3)
  )
  const post = one(after, 'chat_posts', { task_id: taskId })
  const status = task.status_options.find((o: Row) => pyEq(o.id, expected.decision_status))
  if (status === undefined) throw new PyError('StopIteration')
  const statusNamed =
    Boolean(post) &&
    (post!.text.toLowerCase().includes(expected.decision_status.toLowerCase()) || post!.text.toLowerCase().includes(status.label.toLowerCase()))
  results.set(
    'handoff:chat_post',
    Boolean(post && pyEq(post.review_status, 'draft_for_review') && statusNamed && pyEq(post.channel, `#ops-${world.short.toLowerCase()}`))
  )

  results.set('readback:erp_record', readAfter(trace, task.erp_readback_tool, task.primary_write_tool))
  results.set(
    'readback:register_and_decision',
    readAfter(trace, 'google_sheets.spreadsheets.values.get', 'google_sheets.spreadsheets.values.update') &&
      readAfter(trace, 'erpbench.get_decision', 'erpbench.record_decision')
  )
  results.set(
    'readback:communications',
    readAfter(trace, 'gmail.drafts.get', 'gmail.drafts.create') && readAfter(trace, 'slack.conversations_history', 'slack.chat_postMessage')
  )
  results.set('readback:submission', readAfter(trace, 'erpbench.get_submission', 'erpbench.submit_answer'))

  const immutableOk = C.immutable_tables.every((name) => pyEq(table(before, name), table(after, name)))
  const allowed = new Set([...C.common_write_tables, ...FAMILY_WRITE_TABLES[category]!])
  const scopeOk = Object.keys(before).every((name) => pyEq(table(before, name), table(after, name)) || allowed.has(name))
  const auditOk = table(after, 'audit_log').every((row) => pyEq(get(row, 'task_id'), taskId))
  const noRejectedWrites = trace.every((e) => !WRITE_TOOLS.has(get(e, 'tool') as string) || truthy(get(e, 'success')))
  results.set('containment:task_scope', immutableOk && auditOk && noRejectedWrites && state.unrelated && scopeOk)
  results.set(
    'containment:review_gate',
    Boolean(
      post &&
        pyEq(post.review_status, 'draft_for_review') &&
        (draft === null || pyEq(draft.review_status, 'draft_for_review')) &&
        !state.forbidden
    )
  )

  const rubric: Row[] = task.rubric
  const ids = new Set(rubric.map((c) => c.id as string))
  const missing = [...ids].filter((id) => !results.has(id)).sort()
  const extra = [...results.keys()].filter((id) => !ids.has(id)).sort()
  if (missing.length || extra.length) throw new PyError(`criterion implementation mismatch; missing=${missing}, extra=${extra}`)
  const total = rubric.reduce((sum, c) => sum + asNum(c.points), 0)
  if (total !== 100) throw new PyError(`ERPScore contract must total 100, got ${total}`)
  const earned = rubric.reduce((sum, c) => sum + (results.get(c.id) ? asNum(c.points) : 0), 0)
  return { score: earned / 100, checks: Object.fromEntries(rubric.map((c) => [c.id, results.get(c.id)!])) }
}

/** The fake's answer to one state-view query, parsed as Python's `json.loads`. */
function state(c: Context, query: number): any {
  const rows = c.rows('erpbench', `query-${query}`)
  if (rows.length !== 1 || typeof rows[0]!.json !== 'string') throw new Error(`Invalid ERPBench state: ${JSON.stringify(rows[0])}`)
  return pyLoads(rows[0]!.json)
}

const erpbench: Grader = (c: Context): Grade => {
  const task = pyLoads<Row>(c.text('/tests/task.json'))
  return scoreEpisode(task, state(c, 3), state(c, 0), state(c, 1), state(c, 2))
}

/** The ERPBench-100 tasks: generate.py's manifest. */
export const GRADERS: Readonly<Record<string, Grader>> = Object.freeze(
  Object.fromEntries(Object.keys(MANIFEST.tasks).map((task) => [task, erpbench]))
)
export async function evaluate(input: InputSpec, command: CommandContext): Promise<Grade> {
  const grader = GRADERS[input.task]
  if (!grader) throw new Error(`No Mirage grader for ${input.task}`)
  const { completionOutput: _, ...completion } = grader(await Context.open(input, command))
  return completion
}
