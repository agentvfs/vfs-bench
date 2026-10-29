/**
 * The finance fake's API: upstream's `src/routes/*.ts` and the dashboard
 * queries of `src/db/queries/dashboard.ts`, each statement kept, over the
 * run's Prisma client.
 *
 * Each route answers in the order upstream's middleware does
 * (mock-lib's `openApiRoute`): on a path without parameters, the session
 * (401) and the body's type (415) come before zod's validation (400); on a
 * path with one (`{id}`), validation comes first, then the type, then the
 * session. A `SELECT *` reply lists upstream's columns in their order, and
 * a list is in the order SQLite returns it without `ORDER BY`: by row, or by
 * the index a filter is looked up in (`BY_MONTH`).
 *
 * What a run cannot share with another is the kit's: `ctx.clock` for every
 * `datetime('now')` and `Date.now()` (frozen at the reset's epoch, a second
 * per write), and the run's session secret and faults (session.ts).
 */
import { pbkdf2 } from 'node:crypto'
import { promisify } from 'node:util'

import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, JsonValue, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Prisma } from './client/index.js'
import { INVOICE_CATEGORY_CODES } from './config.ts'
import type { C } from './config.ts'
import { session, shouldInject, sign, tokenCookie } from './session.ts'
import {
  INTERNAL,
  INVALID_JSON,
  type Issue,
  type Schema,
  check,
  failure,
  formBody,
  formatted,
  invalid,
  isReply,
  json,
  jsonBody,
  jsonType,
  jsonValid,
  parseFormBody,
  redirect,
  round2,
  rowId,
  sqliteNow,
  z,
} from './wire.ts'


/** A handler, given the user the session names (`c.var.userId`). */
type Handler = (ctx: Ctx<C>, userId: number | undefined) => Promise<Reply> | Reply

/** Hono's `c.req.json()`, which throws (mock-lib answers 400) on a body that is not JSON. */
class NotJson extends Error {}

function body(ctx: Ctx<C>): unknown {
  const value = jsonBody(ctx.body)
  if (value === undefined) throw new NotJson()
  return value
}

/** The run's clock, as SQLite's `datetime('now')` writes it; each call is a write's tick. */
const now = (ctx: Ctx<C>) => sqliteNow(ctx.clock.nowIso())

/** mock-lib's `authRequired` (JSON form): the user, or its 401. */
export function signedIn(ctx: Ctx<C>): { userId: number | undefined } | Reply {
  const found = session(ctx)
  if (found === 'missing') return failure(401, 'Authentication required')
  if (found === 'invalid') return failure(401, 'Invalid or expired token')
  return found
}

/** The request's `Content-Type`, if it has one. */
const typeOf = (ctx: Ctx<C>) => (typeof ctx.headers['content-type'] === 'string' ? ctx.headers['content-type'] : undefined)

const jsonTypeOf = (ctx: Ctx<C>) => jsonType(typeOf(ctx))
const jsonValidOf = (ctx: Ctx<C>, schema: Schema) => jsonValid(typeOf(ctx), ctx.body, schema)

/** Hono's `c.req.queries()`, one value or a list per name, as its query validator reads it. */
function queries(ctx: Ctx<C>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const key of new Set(ctx.query.keys())) {
    const all = ctx.query.getAll(key)
    out[key] = all.length === 1 ? all[0]! : all
  }
  return out
}

interface Api {
  method: string
  path: string
  handler: Handler
  query?: Schema
  body?: Schema
  write?: boolean
}

/** `IdParamSchema`, `{id: z.coerce.number()}`. */
const ID_PARAM = z.object({ id: z.number({ coerce: true }) })

/** One of upstream's `openApiRoute`s, with `{ auth: "required" }`. */
function api(spec: Api): KitRoute<C> {
  const parameterized = spec.path.includes(':')
  const validate = (ctx: Ctx<C>): Reply | null => {
    const issues: Issue[] = []
    if (spec.query !== undefined) issues.push(...check(spec.query, queries(ctx)))
    if (issues.length > 0) return invalid(issues)
    if (parameterized) {
      const params = check(ID_PARAM, ctx.params)
      if (params.length > 0) return invalid(params)
    }
    return spec.body === undefined ? null : jsonValidOf(ctx, spec.body)
  }
  return route<C>(
    spec.method,
    spec.path,
    async (ctx) => {
      try {
        let user: { userId: number | undefined } | Reply
        if (parameterized) {
          const refused = validate(ctx) ?? (spec.body === undefined ? null : jsonTypeOf(ctx))
          if (refused !== null) return refused
          user = signedIn(ctx)
          if (isReply(user)) return user
        } else {
          user = signedIn(ctx)
          if (isReply(user)) return user
          const refused = (spec.body === undefined ? null : jsonTypeOf(ctx)) ?? validate(ctx)
          if (refused !== null) return refused
        }
        return await spec.handler(ctx, user.userId)
      } catch (error) {
        return error instanceof NotJson ? INVALID_JSON() : INTERNAL()
      }
    },
    { write: spec.write === true },
  )
}

/** The id param, as upstream's handler reads it (`Number(c.req.param("id"))`). */
const idOf = (ctx: Ctx<C>) => rowId(Number(ctx.params.id))

// --- auth ---

const pbkdf2Async = promisify(pbkdf2)

/** Upstream's `verifyWerkzeugHash`: `pbkdf2:sha256:<iterations>$<salt>$<hash>`, the salt's text as the salt. */
async function verifyWerkzeugHash(hash: string, password: string): Promise<boolean> {
  const parts = hash.split('$')
  if (parts.length !== 3) return false
  const [method, salt, stored] = parts as [string, string, string]
  const match = /^pbkdf2:sha256:(\d+)$/.exec(method)
  if (!match) return false
  const derived = await pbkdf2Async(Buffer.from(password, 'utf8'), Buffer.from(salt, 'utf8'), Number.parseInt(match[1]!, 10), 32, 'sha256')
  return derived.toString('hex') === stored
}

const LOGIN = z.object({ username: z.string(), password: z.string() })

async function login(ctx: Ctx<C>): Promise<Reply> {
  const { username, password } = body(ctx) as { username: string; password: string }
  const row = await ctx.db.user.findUnique({
    select: { id: true, password_hash: true, role: true, is_active: true },
    where: { username },
  })
  if (!row || !(await verifyWerkzeugHash(row.password_hash, password)) || row.is_active !== 1) {
    return json(401, { error: 'Invalid credentials' })
  }
  const jwt = sign(ctx, { userId: row.id, role: row.role })
  return { status: 200, body: { user: { id: row.id, username, role: row.role } }, headers: { 'Set-Cookie': tokenCookie(jwt) } }
}

function logout(): Reply {
  return redirect('/login', { 'Set-Cookie': tokenCookie('', 0) })
}

// --- departments ---

const DEPARTMENT_QUERY = z.object({ month: z.optional(z.string()), department: z.optional(z.string()) })

/**
 * SQLite looks `month = ?` up in the table's `UNIQUE(month,
 * department_name)` index, so those rows come back by department.
 */
const BY_MONTH = { department_name: 'asc' } as const

async function listDepartments(ctx: Ctx<C>): Promise<Reply> {
  const month = ctx.query.get('month')
  const department = ctx.query.get('department')
  const rows = await ctx.db.departmentFinancialRecord.findMany({
    where: { ...(month ? { month } : {}), ...(department ? { department_name: department } : {}) },
    orderBy: month ? BY_MONTH : { id: 'asc' },
  })
  return json(200, { data: rows })
}

const BUDGET_ALERT = z.object({
  month: z.string(),
  department_name: z.optional(z.string()),
  threshold: z.optional(z.number()),
})

/** mock-lib's one registered finance fault. */
const BUDGET_SHIFT = 'finance-budget-shift::finance::POST /api/departments/budget-alerts::c1-budget-shift'

/** The run's `TASK_NAME`, which its fixture states. */
async function taskName(db: C): Promise<string> {
  return (await db.runEnv.findUnique({ where: { name: 'TASK_NAME' } }))?.value ?? ''
}

async function budgetAlerts(ctx: Ctx<C>): Promise<Reply> {
  const raw = jsonBody(ctx.body)
  if (raw === undefined) return json(400, { error: 'Invalid JSON' })
  const { month, department_name, threshold } = raw as { month?: string; department_name?: string; threshold?: number }
  if (!month) return json(400, { error: 'month is required' })

  const task = await taskName(ctx.db)
  // For finance-budget-shift: auto-fix A2 corruption (negative actual_expense)
  // before applying C1 shift, then enforce threshold against post-shift budget.
  if (task === 'finance-budget-shift') {
    const stamp = now(ctx)
    const negative = await ctx.db.departmentFinancialRecord.findMany({
      select: { id: true, actual_expense_amount: true },
      where: { month: '2026-03', actual_expense_amount: { lt: 0 } },
    })
    await ctx.db.$transaction(
      negative.map((r) =>
        ctx.db.departmentFinancialRecord.update({
          where: { id: r.id },
          data: { actual_expense_amount: Math.abs(r.actual_expense_amount), updated_at: stamp },
        }),
      ),
    )
    // C1: one-shot lower budget for non-violating departments
    if (shouldInject(ctx.db, BUDGET_SHIFT)) {
      await ctx.db.departmentFinancialRecord.updateMany({
        where: { month: '2026-03', department_name: { in: ['HR', 'Finance', 'Operations'] } },
        data: { budget_amount: 100000.0, updated_at: stamp },
      })
    }
  }

  const rows = await ctx.db.departmentFinancialRecord.findMany({
    select: { department_name: true, budget_amount: true, actual_expense_amount: true, manager_email: true },
    where: { month },
    orderBy: BY_MONTH,
  })
  const violations = rows.filter((r) => r.actual_expense_amount < 0 || r.actual_expense_amount > r.budget_amount)

  // Persist budget alert record when agent explicitly sets up an alert
  if (department_name && threshold !== undefined) {
    if (task === 'finance-budget-shift') {
      const deptRow = rows.find((r) => r.department_name === department_name)
      if (deptRow && threshold > deptRow.budget_amount) {
        return json(400, {
          error: 'THRESHOLD_EXCEEDED',
          message: `Threshold ${threshold} exceeds budget ${deptRow.budget_amount} for ${department_name}`,
          budget_amount: deptRow.budget_amount,
        })
      }
    }
    await ctx.db.budgetAlert.create({ data: { department_name, threshold, month, created_at: now(ctx) } })
  }

  return json(200, {
    month,
    total_departments: rows.length,
    violations: violations.map((v) => ({
      department: v.department_name,
      manager_email: v.manager_email,
      budget_amount: v.budget_amount,
      actual_expense_amount: v.actual_expense_amount,
      violation_type: v.actual_expense_amount < 0 ? 'negative_expense' : 'over_budget',
    })),
  })
}

// --- transactions ---

const TRANSACTION_QUERY = z.object({
  status: z.optional(z.string()),
  category: z.optional(z.string()),
  vendor: z.optional(z.string()),
})

async function listTransactions(ctx: Ctx<C>): Promise<Reply> {
  const status = ctx.query.get('status')
  const category = ctx.query.get('category')
  const vendor = ctx.query.get('vendor')
  const rows = await ctx.db.transactionRecord.findMany({
    where: { ...(status ? { status } : {}), ...(category ? { category } : {}), ...(vendor ? { vendor_name: vendor } : {}) },
    orderBy: { id: 'asc' },
  })
  return json(200, { data: rows })
}

async function getTransaction(ctx: Ctx<C>): Promise<Reply> {
  const row = await ctx.db.transactionRecord.findUnique({ where: { id: idOf(ctx) } })
  return row === null ? json(404, { error: 'Not found' }) : json(200, row)
}

async function flagTransaction(ctx: Ctx<C>): Promise<Reply> {
  const id = idOf(ctx)
  await ctx.db.transactionRecord.updateMany({ where: { id }, data: { status: 'flagged', updated_at: now(ctx) } })
  const row = await ctx.db.transactionRecord.findUnique({ select: { id: true, status: true }, where: { id } })
  return row === null ? json(404, { error: 'Not found' }) : json(200, row)
}

// --- accounts ---

async function listAccounts(ctx: Ctx<C>): Promise<Reply> {
  return json(200, { data: await ctx.db.accountBalance.findMany({ orderBy: { id: 'asc' } }) })
}

async function accountTransactions(ctx: Ctx<C>): Promise<Reply> {
  const rows = await ctx.db.accountTransaction.findMany({ where: { account_balance_id: idOf(ctx) }, orderBy: { id: 'asc' } })
  return json(200, { data: rows })
}

async function flagAccount(ctx: Ctx<C>): Promise<Reply> {
  const id = idOf(ctx)
  await ctx.db.accountBalance.updateMany({ where: { id }, data: { status: 'flagged', updated_at: now(ctx) } })
  const row = await ctx.db.accountBalance.findUnique({ select: { id: true, status: true }, where: { id } })
  return row === null ? json(404, { error: 'Not found' }) : json(200, row)
}

// --- expense reports ---

const EXPENSE_CREATE = z.object({
  trip_name: z.string(),
  items: z.array(z.object({ expense_category: z.enum(['flight', 'hotel', 'meals', 'transport']), amount: z.number() })),
})

async function createExpenseReport(ctx: Ctx<C>, userId: number | undefined): Promise<Reply> {
  const { trip_name, items } = body(ctx) as { trip_name: string; items: { expense_category: string; amount: number }[] }
  if (!items || items.length === 0) return json(400, { error: 'At least one expense item is required' })
  const total = items.reduce((s, item) => s + item.amount, 0)
  const stamp = now(ctx)
  const report = await ctx.db.expenseReport.create({
    data: {
      trip_name,
      total_amount: round2(total),
      status: 'draft',
      created_by_user_id: userId ?? 1,
      created_at: stamp,
      updated_at: stamp,
      items: {
        create: items.map((item) => ({ expense_category: item.expense_category, amount: round2(item.amount), created_at: stamp, updated_at: stamp })),
      },
    },
  })
  return json(200, report)
}

async function submitExpenseReport(ctx: Ctx<C>): Promise<Reply> {
  const id = idOf(ctx)
  if ((await ctx.db.expenseReport.findUnique({ select: { id: true }, where: { id } })) === null) {
    return json(404, { error: 'Not found' })
  }
  const row = await ctx.db.expenseReport.update({
    select: { id: true, status: true },
    where: { id },
    data: { status: 'submitted', updated_at: now(ctx) },
  })
  return json(200, row)
}

// --- vendors and invoices ---

async function listVendors(ctx: Ctx<C>): Promise<Reply> {
  return json(200, { data: await ctx.db.vendor.findMany({ orderBy: { id: 'asc' } }) })
}

const INVOICE_CREATE = z.object({
  vendor_id: z.number(),
  invoice_number: z.string(),
  invoice_date: z.string(),
  items: z.array(z.object({ description: z.string(), category_code: z.string(), amount: z.number() })),
})

async function createInvoice(ctx: Ctx<C>): Promise<Reply> {
  const { vendor_id, invoice_number, invoice_date, items } = body(ctx) as {
    vendor_id: number
    invoice_number: string
    invoice_date: string
    items: { description: string; category_code: string; amount: number }[]
  }
  for (const item of items) {
    if (!INVOICE_CATEGORY_CODES.includes(item.category_code)) {
      return json(400, { error: `Invalid category code: ${item.category_code}` })
    }
  }
  const vendor = await ctx.db.vendor.findUnique({ select: { vendor_name: true }, where: { id: rowId(vendor_id) } })
  if (vendor === null) return json(400, { error: 'Vendor not found' })
  const stamp = now(ctx)
  const invoice = await ctx.db.invoice.create({
    data: {
      vendor_id,
      vendor_name: vendor.vendor_name,
      invoice_number,
      invoice_date,
      status: 'submitted',
      created_at: stamp,
      updated_at: stamp,
      items: {
        create: items.map((item) => ({
          description: item.description,
          category_code: item.category_code,
          amount: round2(item.amount),
          created_at: stamp,
          updated_at: stamp,
        })),
      },
    },
  })
  return json(200, invoice)
}

// --- assets ---

/**
 * `asset_record`'s rows as SQLite holds them. Upstream's edit writes
 * `useful_life_years` as the request gives it, and SQLite keeps a fraction
 * in that INTEGER column, which Prisma's typed reads and writes truncate;
 * so this table is read and edited in SQL.
 */
export function assetRows(db: C, id?: number): Promise<Record<string, JsonValue>[]> {
  return id === undefined
    ? db.$queryRaw`SELECT * FROM asset_record ORDER BY id`
    : db.$queryRaw`SELECT * FROM asset_record WHERE id = ${id}`
}

async function listAssets(ctx: Ctx<C>): Promise<Reply> {
  return json(200, { data: await assetRows(ctx.db) })
}

async function getAsset(ctx: Ctx<C>): Promise<Reply> {
  const [row] = await assetRows(ctx.db, idOf(ctx))
  return row === undefined ? json(404, { error: 'Not found' }) : json(200, row)
}

const ASSET_EDIT = z.object({
  cost_basis: z.number(),
  residual_value: z.number(),
  useful_life_years: z.number(),
  depreciation_method: z.enum(['straight_line', 'declining_balance']),
  annual_depreciation: z.number(),
  correction_reason: z.string(),
})

async function editAsset(ctx: Ctx<C>): Promise<Reply> {
  const id = idOf(ctx)
  const edit = body(ctx) as {
    cost_basis: number
    residual_value: number
    useful_life_years: number
    depreciation_method: string
    annual_depreciation: number
    correction_reason: string
  }
  if (!edit.correction_reason || edit.correction_reason.trim() === '') {
    return json(400, { error: 'correction_reason is required' })
  }
  if ((await assetRows(ctx.db, id)).length === 0) return json(404, { error: 'Not found' })
  await ctx.db.$executeRaw`UPDATE asset_record SET
    cost_basis = ${round2(edit.cost_basis)}, residual_value = ${round2(edit.residual_value)},
    useful_life_years = ${edit.useful_life_years}, depreciation_method = ${edit.depreciation_method},
    annual_depreciation = ${round2(edit.annual_depreciation)}, correction_reason = ${edit.correction_reason},
    updated_at = ${now(ctx)}
  WHERE id = ${id}`
  const [row] = await assetRows(ctx.db, id)
  return json(200, row!)
}

// --- system config ---

async function systemConfig(ctx: Ctx<C>): Promise<Reply> {
  const rows = await ctx.db.systemConfig.findMany({ select: { config_key: true, config_value: true }, orderBy: { id: 'asc' } })
  return json(200, Object.fromEntries(rows.map((r) => [r.config_key, r.config_value])))
}

// --- dashboard ---

type FormulaNode =
  | { op: 'field'; name: 'budget_amount' | 'actual_expense_amount' | 'revenue_amount' }
  | { op: 'const'; value: number }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: FormulaNode; right: FormulaNode }
  | { op: 'sum'; args: FormulaNode[] }

const FIELDS = ['budget_amount', 'actual_expense_amount', 'revenue_amount']

const binaryEvaluators: Record<'add' | 'subtract' | 'multiply' | 'divide', (l: number, r: number) => number | null> = {
  add: (l, r) => l + r,
  subtract: (l, r) => l - r,
  multiply: (l, r) => l * r,
  divide: (l, r) => (r === 0 ? null : l / r),
}

function evalFormula(node: FormulaNode, record: Record<string, number | null>): number | null {
  switch (node.op) {
    case 'field':
      return record[node.name] ?? null
    case 'const':
      return node.value
    case 'sum': {
      let total = 0
      for (const arg of node.args) {
        const v = evalFormula(arg, record)
        if (v !== null) total += v
      }
      return total
    }
    default: {
      const l = evalFormula(node.left, record)
      const r = evalFormula(node.right, record)
      if (l === null || r === null) return null
      return binaryEvaluators[node.op](l, r)
    }
  }
}

function formulaDepth(node: FormulaNode): number {
  switch (node.op) {
    case 'field':
    case 'const':
      return 1
    case 'sum':
      return 1 + (node.args.length > 0 ? Math.max(...node.args.map(formulaDepth)) : 0)
    default:
      return 1 + Math.max(formulaDepth(node.left), formulaDepth(node.right))
  }
}

function validateFormulaNode(node: unknown): node is FormulaNode {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Record<string, unknown>
  if (typeof n.op !== 'string') return false
  switch (n.op) {
    case 'field':
      return typeof n.name === 'string' && FIELDS.includes(n.name)
    case 'const':
      return typeof n.value === 'number'
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return validateFormulaNode(n.left) && validateFormulaNode(n.right)
    case 'sum':
      return Array.isArray(n.args) && n.args.every(validateFormulaNode)
    default:
      return false
  }
}

function parseAndValidateFormula(jsonStr: string | null): { formula: FormulaNode | null; error: string | null } {
  if (!jsonStr || jsonStr === '{}' || jsonStr.trim() === '') return { formula: null, error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return { formula: null, error: 'Invalid JSON' }
  }
  if (!validateFormulaNode(parsed)) return { formula: null, error: 'Invalid formula structure' }
  if (formulaDepth(parsed) > 5) return { formula: null, error: 'Formula depth exceeds 5' }
  return { formula: parsed, error: null }
}

export interface DashboardConfigRow {
  id: number
  user_id: number
  date_range_start: string
  date_range_end: string
  formula_json: string | null
  department_weight_json: string | null
}

function isValidWeights(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((v) => typeof v === 'number')
}

function validateDashboardConfig(row: Omit<DashboardConfigRow, 'id' | 'user_id'>): string | null {
  if (row.date_range_start > row.date_range_end) return 'Invalid date range'
  const formulaCheck = parseAndValidateFormula(row.formula_json)
  if (formulaCheck.error) return formulaCheck.error
  try {
    const parsed = JSON.parse(row.department_weight_json || '{}') as unknown
    if (!isValidWeights(parsed)) return 'Invalid department weights: must be an object with numeric values'
  } catch {
    return 'Invalid department weights JSON'
  }
  return null
}

async function fetchConfig(db: C, userId: number | undefined): Promise<DashboardConfigRow | null> {
  if (userId === undefined) return null
  return db.dashboardConfig.findUnique({
    select: { id: true, user_id: true, date_range_start: true, date_range_end: true, formula_json: true, department_weight_json: true },
    where: { user_id: rowId(userId) },
  })
}

/** Upstream's `getEffectiveConfig`: the user's config if valid, else the admin's, else the default. */
export async function getEffectiveConfig(db: C, userId: number | undefined): Promise<DashboardConfigRow> {
  const userConfig = await fetchConfig(db, userId)
  if (userConfig && !validateDashboardConfig(userConfig)) return userConfig
  const admin = await db.user.findFirst({ select: { id: true }, where: { role: 'admin' }, orderBy: { id: 'asc' } })
  if (admin) {
    const adminConfig = await fetchConfig(db, admin.id)
    if (adminConfig && !validateDashboardConfig(adminConfig)) return adminConfig
  }
  return {
    id: 0,
    user_id: userId as number,
    date_range_start: '2026-01-01',
    date_range_end: '2026-12-31',
    formula_json: '{}',
    department_weight_json: '{}',
  }
}

export interface DashboardMetrics {
  kpis: { revenue: number; expense: number; profit: number }
  monthly: { month: string; revenue: number; expense: number; profit: number }[]
}

/** Upstream's `computeDashboardMetrics`. */
export async function computeDashboardMetrics(db: C, config: DashboardConfigRow): Promise<DashboardMetrics> {
  const rows = await db.departmentFinancialRecord.findMany({
    select: { month: true, department_name: true, budget_amount: true, actual_expense_amount: true, revenue_amount: true },
    where: { month: { gte: config.date_range_start.slice(0, 7), lte: config.date_range_end.slice(0, 7) } },
    orderBy: [{ month: 'asc' }, { department_name: 'asc' }],
  })
  let weights: Record<string, number> = {}
  try {
    weights = JSON.parse(config.department_weight_json || '{}') as Record<string, number>
  } catch {
    weights = {}
  }
  const customFormula = parseAndValidateFormula(config.formula_json).formula

  // Monthly aggregation with empty month fill
  const monthlyMap = new Map<string, { revenue: number; expense: number; profit: number }>()
  for (const r of rows) {
    if (!monthlyMap.has(r.month)) monthlyMap.set(r.month, { revenue: 0, expense: 0, profit: 0 })
    const m = monthlyMap.get(r.month)!
    const w = weights[r.department_name] ?? 1.0
    if (customFormula) {
      const v = evalFormula(customFormula, r as unknown as Record<string, number | null>)
      if (v !== null) m.revenue += round2(v * w)
    } else {
      const rev = r.revenue_amount ?? 0
      const exp = r.actual_expense_amount ?? 0
      m.revenue += round2(rev * w)
      m.expense += round2(exp * w)
      m.profit += round2((rev - exp) * w)
    }
  }

  // Fill empty months
  const start = new Date(config.date_range_start + 'T00:00:00')
  const end = new Date(config.date_range_end + 'T00:00:00')
  const allMonths: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    allMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  const monthly = allMonths.map((month) => ({
    month,
    revenue: monthlyMap.get(month)?.revenue ?? 0,
    expense: monthlyMap.get(month)?.expense ?? 0,
    profit: monthlyMap.get(month)?.profit ?? 0,
  }))
  const revenue = monthly.reduce((s, m) => s + m.revenue, 0)
  const expense = monthly.reduce((s, m) => s + m.expense, 0)
  const profit = monthly.reduce((s, m) => s + m.profit, 0)
  return { kpis: { revenue: round2(revenue), expense: round2(expense), profit: round2(profit) }, monthly }
}

async function dashboard(ctx: Ctx<C>, userId: number | undefined): Promise<Reply> {
  const config = await getEffectiveConfig(ctx.db, userId)
  const metrics = await computeDashboardMetrics(ctx.db, config)
  return json(200, {
    config: {
      date_range_start: config.date_range_start,
      date_range_end: config.date_range_end,
      formula_json: config.formula_json,
      department_weight_json: config.department_weight_json,
    },
    kpis: metrics.kpis,
    monthly: metrics.monthly,
  } as JsonValue)
}

const DASHBOARD_CONFIG = z.object({
  date_range_start: z.string({ regex: /^\d{4}-\d{2}-\d{2}$/ }),
  date_range_end: z.string({ regex: /^\d{4}-\d{2}-\d{2}$/ }),
  formula_json: z.default(z.string({ max: 10240 }), '{}'),
  department_weight_json: z.default(z.string({ max: 4096 }), '{}'),
})

/** A body as upstream's dashboard and order handlers read one: JSON by its type, else a form. */
async function jsonOrForm(ctx: Ctx<C>): Promise<unknown> {
  const contentType = String(ctx.headers['content-type'] ?? '')
  if (contentType.includes('application/json')) return body(ctx)
  return formBody(contentType, ctx.body)
}

async function updateDashboardConfig(ctx: Ctx<C>, userId: number | undefined): Promise<Reply> {
  const user = userId === undefined ? null : await ctx.db.user.findUnique({ select: { role: true }, where: { id: rowId(userId) } })
  if (!user || user.role !== 'admin') return json(403, { error: 'Forbidden' })
  const raw = await jsonOrForm(ctx)
  const issues: Issue[] = []
  const parsed = DASHBOARD_CONFIG(raw, [], issues) as {
    date_range_start: string
    date_range_end: string
    formula_json: string
    department_weight_json: string
  }
  if (issues.length > 0) return json(400, { error: 'Invalid input', details: formatted(issues) })
  const configError = validateDashboardConfig(parsed)
  if (configError) return json(400, { error: configError })
  const { date_range_start, date_range_end, formula_json, department_weight_json } = parsed
  // INSERT ... ON CONFLICT(user_id) DO UPDATE, which leaves the timestamps.
  const stamp = now(ctx)
  await ctx.db.dashboardConfig.upsert({
    where: { user_id: userId as number },
    create: { user_id: userId as number, date_range_start, date_range_end, formula_json, department_weight_json, created_at: stamp, updated_at: stamp },
    update: { date_range_start, date_range_end, formula_json, department_weight_json },
  })
  return json(200, { success: true })
}

// --- portfolio ---

export async function portfolioHoldings(db: C) {
  return db.portfolioHolding.findMany({ orderBy: { asset_class_code: 'asc' } })
}

const CREATE_ORDER = z.object({
  asset_class_code: z.enum(['eq', 'fi', 'ca', 'al']),
  direction: z.enum(['buy', 'sell']),
  amount: z.number({ positive: true }),
})

/** Upstream's `executePortfolioOrder`. */
export async function executePortfolioOrder(
  ctx: Ctx<C>,
  order: unknown,
): Promise<{ success: true; order: JsonValue } | { success: false; error: string }> {
  if (check(CREATE_ORDER, order).length > 0) return { success: false, error: 'Invalid input' }
  const { asset_class_code, direction, amount } = order as { asset_class_code: string; direction: string; amount: number }
  const stamp = now(ctx)
  const placed = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
    const holding = await tx.portfolioHolding.findUnique({ select: { current_value: true }, where: { asset_class_code } })
    if (!holding) return 'Holding not found'
    if (direction === 'sell' && amount > holding.current_value) return 'Sell amount exceeds holding value'
    const row = await tx.portfolioOrder.create({
      data: { asset_class_code, direction, amount, status: 'executed', created_at: stamp, updated_at: stamp },
    })
    await tx.portfolioHolding.update({
      where: { asset_class_code },
      data: { current_value: { increment: direction === 'buy' ? amount : -amount } },
    })
    return row
  })
  return typeof placed === 'string' ? { success: false, error: placed } : { success: true, order: placed }
}

async function portfolio(ctx: Ctx<C>): Promise<Reply> {
  const rows = await portfolioHoldings(ctx.db)
  const total_value = rows.reduce((sum, r) => sum + (r.current_value ?? 0), 0)
  return json(200, { holdings: rows, total_value })
}

async function placeOrder(ctx: Ctx<C>): Promise<Reply> {
  const contentType = String(ctx.headers['content-type'] ?? '')
  const raw = contentType.includes('application/json') ? body(ctx) : parseFormBody(await formBody(contentType, ctx.body))
  const result = await executePortfolioOrder(ctx, raw)
  return result.success ? json(201, result.order) : json(400, { error: result.error })
}

// --- the routes ---

/** The routes upstream registers before `authOptional`: mock-lib's health check and the probe. */
export function openRoutes(notFound: () => Reply): KitRoute<C>[] {
  return [
    route<C>('GET', '/health', () => json(200, { ok: true, status: 'healthy', service: 'finance' })),
    // Registered, and gated off outside mock-lib's dev mode.
    route<C>('GET', '/openapi.json', notFound),
    route<C>('GET', '/__mock_sentinel__/finance', () => json(200, { ok: true })),
  ]
}

/** Upstream's API, as each `register*Routes` adds it. */
export function apiRoutes(): KitRoute<C>[] {
  const caught = (handler: (ctx: Ctx<C>) => Promise<Reply> | Reply) => async (ctx: Ctx<C>) => {
    try {
      return await handler(ctx)
    } catch (error) {
      return error instanceof NotJson ? INVALID_JSON() : INTERNAL()
    }
  }
  return [
    route<C>(
      'POST',
      '/api/auth/login',
      caught((ctx) => jsonTypeOf(ctx) ?? jsonValidOf(ctx, LOGIN) ?? login(ctx)),
    ),
    route<C>('POST', '/api/auth/logout', logout),
    api({ method: 'GET', path: '/api/departments', query: DEPARTMENT_QUERY, handler: listDepartments }),
    api({ method: 'POST', path: '/api/departments/budget-alerts', body: BUDGET_ALERT, handler: budgetAlerts, write: true }),
    api({ method: 'GET', path: '/api/transactions', query: TRANSACTION_QUERY, handler: listTransactions }),
    api({ method: 'GET', path: '/api/transactions/:id', handler: getTransaction }),
    api({ method: 'POST', path: '/api/transactions/:id/flag', handler: flagTransaction, write: true }),
    api({ method: 'GET', path: '/api/accounts', handler: listAccounts }),
    api({ method: 'GET', path: '/api/accounts/:id/transactions', handler: accountTransactions }),
    api({ method: 'POST', path: '/api/accounts/:id/flag', handler: flagAccount, write: true }),
    api({ method: 'POST', path: '/api/expense-reports', body: EXPENSE_CREATE, handler: createExpenseReport, write: true }),
    api({ method: 'POST', path: '/api/expense-reports/:id/submit', handler: submitExpenseReport, write: true }),
    api({ method: 'GET', path: '/api/vendors', handler: listVendors }),
    api({ method: 'POST', path: '/api/invoices', body: INVOICE_CREATE, handler: createInvoice, write: true }),
    api({ method: 'GET', path: '/api/assets', handler: listAssets }),
    api({ method: 'GET', path: '/api/assets/:id', handler: getAsset }),
    api({ method: 'POST', path: '/api/assets/:id', body: ASSET_EDIT, handler: editAsset, write: true }),
    api({ method: 'GET', path: '/api/system-config', handler: systemConfig }),
    api({ method: 'GET', path: '/api/dashboard', handler: dashboard }),
    api({ method: 'POST', path: '/api/dashboard/config', handler: updateDashboardConfig, write: true }),
    api({ method: 'GET', path: '/api/portfolio', handler: portfolio }),
    api({ method: 'POST', path: '/api/portfolio/orders', handler: placeOrder, write: true }),
  ]
}
