/**
 * Check the finance kit fake against upstream's finance mock: the same
 * requests to each, on the same seed and clock, and every difference in
 * status, headers, body and the tables each leaves behind.
 *
 *     node harbor/compare.ts [task ...]      # from vfs-bench-2/; default every finance task
 *
 * Needs Bun and LiveClawBench's checkout (`liveclawbench/setup.py`). For each
 * task, upstream's mock runs as an upstream task directory runs it here
 * (`liveclawbench.ts`'s plan: Bun, its own seed and the task's seed SQL),
 * with `fixtures/frozen.ts` freezing `Date` and SQLite's `datetime('now')`
 * at the epoch. The fake is one process for every task (`fakes.ts`), each
 * task a run reset from its committed fixture at the same epoch.
 *
 * Two differences are known and allowed: a write's time (the fake's clock
 * moves a second per write, upstream's stays at the epoch), which also
 * moves a later login token's `iat` and `exp`, and each token's signature
 * (each has its own secret). Password hashes' salts differ in the tables.
 * Anything else is printed, and the check exits 1.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { start } from '../harness/fakes.ts'
import { Run } from '../harness/runs.ts'
import { PLATFORM } from '../liveclawbench/index.ts'
import * as liveclawbench from './liveclawbench.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TASKS = join(HERE, 'tasks', 'liveclawbench')
const EPOCH = '2026-04-03T09:00:00Z'
/** Every committed task on the finance fake. */
const FINANCE = readdirSync(TASKS).filter((t) => t.startsWith('finance-')).sort()

interface Step {
  name: string
  method?: string
  path: string
  /** Which session's token to send: `<name>`, as a cookie, or `<name>:bearer`. */
  as?: string
  headers?: Record<string, string>
  body?: string
  /** Keep the reply's token as this session's. */
  login?: string
}

const JSON_CT = { 'Content-Type': 'application/json' }
const j = (v: unknown) => JSON.stringify(v)
const loginStep = (as: string, user: string, pass: string): Step => ({
  name: `login ${user}`,
  method: 'POST',
  path: '/api/auth/login',
  headers: JSON_CT,
  body: j({ username: user, password: pass }),
  login: as,
})

/**
 * The requests, by flow, each flow on the run as the one before left it:
 * every route, page and login case, the solutions' requests, validation
 * failures, type and body edge cases, and a write of every kind.
 */
const FLOWS: Record<string, Step[]> = {
  open: [
    { name: 'health', path: '/health' },
    { name: 'sentinel', path: '/__mock_sentinel__/finance' },
    { name: 'unknown path', path: '/nope' },
    { name: 'unknown api path', path: '/api/nope' },
    { name: 'openapi gated', path: '/openapi.json' },
    { name: 'trailing slash', path: '/api/transactions/' },
    { name: 'GET invoices (no such route)', path: '/api/invoices' },
    { name: 'PUT transactions', method: 'PUT', path: '/api/transactions' },
    { name: 'home, signed out', path: '/' },
    { name: 'login page', path: '/login' },
    { name: 'no session', path: '/api/transactions' },
    { name: 'no session, page', path: '/dashboard' },
    { name: 'no session, param route', path: '/api/transactions/1' },
    { name: 'no session, param route, bad id', path: '/api/transactions/abc' },
    { name: 'bad token cookie', path: '/api/transactions', headers: { Cookie: 'token=abc.def.ghi' } },
    { name: 'empty token cookie', path: '/api/transactions', headers: { Cookie: 'token=; other=1' } },
    { name: 'bearer garbage', path: '/api/transactions', headers: { Authorization: 'Bearer x.y.z' } },
    { name: 'login form type', method: 'POST', path: '/api/auth/login', body: 'username=admin&password=admin123', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    { name: 'login no type', method: 'POST', path: '/api/auth/login', body: j({ username: 'admin', password: 'admin123' }) },
    { name: 'login missing password', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'admin' }) },
    { name: 'login wrong types', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 1, password: null }) },
    { name: 'login array body', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: '[]' },
    { name: 'login bad json', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: '{bad' },
    { name: 'login empty body', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: '' },
    { name: 'login wrong password', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'admin', password: 'nope' }) },
    { name: 'login unknown user', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'zed', password: 'nope' }) },
    { name: 'login inactive jane', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'jane', password: 'user123' }) },
    { name: 'logout', method: 'POST', path: '/api/auth/logout' },
  ],
  reads: [
    loginStep('admin', 'admin', 'admin123'),
    { name: 'home, signed in', path: '/', as: 'admin' },
    { name: 'bearer works', path: '/api/accounts', as: 'admin:bearer' },
    { name: 'departments', path: '/api/departments', as: 'admin' },
    { name: 'departments march', path: '/api/departments?month=2026-03', as: 'admin' },
    { name: 'departments sales', path: '/api/departments?department=Sales', as: 'admin' },
    { name: 'departments jan+eng', path: '/api/departments?month=2026-01&department=Engineering', as: 'admin' },
    { name: 'departments repeated month', path: '/api/departments?month=2026-01&month=2026-02', as: 'admin' },
    { name: 'transactions', path: '/api/transactions', as: 'admin' },
    { name: 'transactions pending', path: '/api/transactions?status=pending', as: 'admin' },
    { name: 'transactions software', path: '/api/transactions?category=software', as: 'admin' },
    { name: 'transactions vendor', path: '/api/transactions?vendor=Acme%20Corp', as: 'admin' },
    { name: 'transactions vendor plus', path: '/api/transactions?vendor=Acme+Corp', as: 'admin' },
    { name: 'transactions repeated status', path: '/api/transactions?status=a&status=b', as: 'admin' },
    { name: 'transaction 1', path: '/api/transactions/1', as: 'admin' },
    { name: 'transaction 999', path: '/api/transactions/999', as: 'admin' },
    { name: 'transaction abc', path: '/api/transactions/abc', as: 'admin' },
    { name: 'transaction 1.5', path: '/api/transactions/1.5', as: 'admin' },
    { name: 'transaction 1e0', path: '/api/transactions/1e0', as: 'admin' },
    { name: 'accounts', path: '/api/accounts', as: 'admin' },
    { name: 'account 1 transactions', path: '/api/accounts/1/transactions', as: 'admin' },
    { name: 'account 9 transactions', path: '/api/accounts/9/transactions', as: 'admin' },
    { name: 'vendors', path: '/api/vendors', as: 'admin' },
    { name: 'assets', path: '/api/assets', as: 'admin' },
    { name: 'asset 1', path: '/api/assets/1', as: 'admin' },
    { name: 'asset 99', path: '/api/assets/99', as: 'admin' },
    { name: 'system config', path: '/api/system-config', as: 'admin' },
    { name: 'dashboard', path: '/api/dashboard', as: 'admin' },
    { name: 'portfolio', path: '/api/portfolio', as: 'admin' },
    { name: 'page departments', path: '/departments', as: 'admin' },
    { name: 'page transactions', path: '/transactions', as: 'admin' },
    { name: 'page accounts', path: '/accounts', as: 'admin' },
    { name: 'page account 1', path: '/accounts/1', as: 'admin' },
    { name: 'page account 99', path: '/accounts/99', as: 'admin' },
    { name: 'page expenses new', path: '/expenses/new', as: 'admin' },
    { name: 'page invoices new', path: '/invoices/new', as: 'admin' },
    { name: 'page assets', path: '/assets', as: 'admin' },
    { name: 'page asset 2 edit', path: '/assets/2/edit', as: 'admin' },
    { name: 'page asset 99 edit', path: '/assets/99/edit', as: 'admin' },
    { name: 'page dashboard', path: '/dashboard', as: 'admin' },
    { name: 'page portfolio', path: '/portfolio', as: 'admin' },
    { name: 'page portfolio error', path: '/portfolio?error=Boom%20%3Cb%3E', as: 'admin' },
    loginStep('john', 'john', 'user123'),
    { name: 'dashboard as john', path: '/api/dashboard', as: 'john' },
    { name: 'page dashboard as john', path: '/dashboard', as: 'john' },
    { name: 'dashboard config as john', method: 'POST', path: '/api/dashboard/config', as: 'john', headers: JSON_CT, body: '{}' },
  ],
  edges: [
    loginStep('admin', 'admin', 'admin123'),
    { name: 'login charset type', method: 'POST', path: '/api/auth/login', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: j({ username: 'admin', password: 'admin123' }) },
    { name: 'expense trailing semicolon type', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: { 'Content-Type': 'application/json;' }, body: j({ trip_name: 'T', items: [{ expense_category: 'meals', amount: 1 }] }) },
    { name: 'expense upper type', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: { 'Content-Type': 'Application/JSON' }, body: j({ trip_name: 'T', items: [{ expense_category: 'meals', amount: 1 }] }) },
    { name: 'asset fractional life', method: 'POST', path: '/api/assets/3', as: 'admin', headers: JSON_CT, body: j({ cost_basis: 30000, residual_value: 3000, useful_life_years: 4.5, depreciation_method: 'straight_line', annual_depreciation: 6000, correction_reason: 'x' }) },
    { name: 'assets after fractional', path: '/api/assets', as: 'admin' },
    { name: 'HEAD accounts', method: 'HEAD', path: '/api/accounts', as: 'admin' },
    { name: 'empty status filter', path: '/api/transactions?status=', as: 'admin' },
    { name: 'page account abc', path: '/accounts/abc', as: 'admin' },
    { name: 'dashboard config multipart', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: { 'Content-Type': 'multipart/form-data; boundary=XyZ' }, body: '--XyZ\r\nContent-Disposition: form-data; name="date_range_start"\r\n\r\n2026-02-01\r\n--XyZ\r\nContent-Disposition: form-data; name="date_range_end"\r\n\r\n2026-03-31\r\n--XyZ--\r\n' },
    { name: 'dashboard after multipart', path: '/api/dashboard', as: 'admin' },
    { name: 'order null json', method: 'POST', path: '/api/portfolio/orders', as: 'admin', headers: JSON_CT, body: 'null' },
    { name: 'budget alert null body', method: 'POST', path: '/api/departments/budget-alerts', as: 'admin', headers: JSON_CT, body: 'null' },
    { name: 'invoice float vendor', method: 'POST', path: '/api/invoices', as: 'admin', headers: JSON_CT, body: j({ vendor_id: 1.5, invoice_number: 'X', invoice_date: 'd', items: [] }) },
    { name: 'invoice no items', method: 'POST', path: '/api/invoices', as: 'admin', headers: JSON_CT, body: j({ vendor_id: 1, invoice_number: 'INV-E', invoice_date: '2026-03-02', items: [] }) },
    { name: 'flag big id', method: 'POST', path: '/api/transactions/99999999999/flag', as: 'admin' },
    { name: 'expense items not array', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: JSON_CT, body: j({ trip_name: 5, items: { a: 1 } }) },
  ],
  writes: [
    loginStep('admin', 'admin', 'admin123'),
    { name: 'flag txn 2', method: 'POST', path: '/api/transactions/2/flag', as: 'admin' },
    { name: 'flag txn 999', method: 'POST', path: '/api/transactions/999/flag', as: 'admin' },
    { name: 'flag account 2', method: 'POST', path: '/api/accounts/2/flag', as: 'admin', headers: JSON_CT },
    { name: 'expense wrong type', method: 'POST', path: '/api/expense-reports', as: 'admin', body: '{}' },
    { name: 'expense bad category', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: JSON_CT, body: j({ trip_name: 'T', items: [{ expense_category: 'taxi', amount: 5 }, { expense_category: 3, amount: '4' }] }) },
    { name: 'expense missing all', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: JSON_CT, body: '{}' },
    { name: 'expense empty items', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: JSON_CT, body: j({ trip_name: 'T', items: [] }) },
    { name: 'expense ok', method: 'POST', path: '/api/expense-reports', as: 'admin', headers: JSON_CT, body: j({ trip_name: 'March Marketing Trip', items: [{ expense_category: 'flight', amount: 1200 }, { expense_category: 'hotel', amount: 900.555 }, { expense_category: 'meals', amount: 350 }] }) },
    { name: 'expense submit 3', method: 'POST', path: '/api/expense-reports/3/submit', as: 'admin', headers: JSON_CT },
    { name: 'expense submit 99', method: 'POST', path: '/api/expense-reports/99/submit', as: 'admin' },
    { name: 'invoice bad code', method: 'POST', path: '/api/invoices', as: 'admin', headers: JSON_CT, body: j({ vendor_id: 2, invoice_number: 'X', invoice_date: '2026-03-01', items: [{ description: 'a', category_code: '9999', amount: 1 }] }) },
    { name: 'invoice no vendor', method: 'POST', path: '/api/invoices', as: 'admin', headers: JSON_CT, body: j({ vendor_id: 42, invoice_number: 'X', invoice_date: '2026-03-01', items: [] }) },
    { name: 'invoice missing fields', method: 'POST', path: '/api/invoices', as: 'admin', headers: JSON_CT, body: j({ vendor_id: '2', items: [{}] }) },
    { name: 'invoice ok', method: 'POST', path: '/api/invoices', as: 'admin', headers: JSON_CT, body: j({ vendor_id: 2, invoice_number: 'INV-2026-004', invoice_date: '2026-03-01', items: [{ description: 'Travel Expenses', category_code: '5100', amount: 5000 }, { description: 'Consulting', category_code: '5400', amount: 3000.125 }] }) },
    { name: 'asset no type', method: 'POST', path: '/api/assets/2', as: 'admin', body: '{}' },
    { name: 'asset bad id', method: 'POST', path: '/api/assets/x', as: 'admin', headers: JSON_CT, body: '{}' },
    { name: 'asset invalid', method: 'POST', path: '/api/assets/2', as: 'admin', headers: JSON_CT, body: j({ cost_basis: 1, depreciation_method: 'sum_of_years' }) },
    { name: 'asset blank reason', method: 'POST', path: '/api/assets/2', as: 'admin', headers: JSON_CT, body: j({ cost_basis: 80000, residual_value: 8000, useful_life_years: 4, depreciation_method: 'straight_line', annual_depreciation: 18000, correction_reason: '  ' }) },
    { name: 'asset 99', method: 'POST', path: '/api/assets/99', as: 'admin', headers: JSON_CT, body: j({ cost_basis: 80000, residual_value: 8000, useful_life_years: 4, depreciation_method: 'straight_line', annual_depreciation: 18000, correction_reason: 'x' }) },
    { name: 'asset ok', method: 'POST', path: '/api/assets/2', as: 'admin', headers: JSON_CT, body: j({ cost_basis: 80000.004, residual_value: 8000, useful_life_years: 4, depreciation_method: 'straight_line', annual_depreciation: 18000, correction_reason: 'fixed' }) },
    { name: 'asset after', path: '/api/assets/2', as: 'admin' },
    { name: 'budget alert no month', method: 'POST', path: '/api/departments/budget-alerts', as: 'admin', headers: JSON_CT, body: '{}' },
    { name: 'budget alert empty month', method: 'POST', path: '/api/departments/budget-alerts', as: 'admin', headers: JSON_CT, body: j({ month: '' }) },
    { name: 'budget alert summary', method: 'POST', path: '/api/departments/budget-alerts', as: 'admin', headers: JSON_CT, body: j({ month: '2026-03' }) },
    { name: 'budget alert too high', method: 'POST', path: '/api/departments/budget-alerts', as: 'admin', headers: JSON_CT, body: j({ month: '2026-03', department_name: 'HR', threshold: 120000 }) },
    { name: 'budget alert marketing', method: 'POST', path: '/api/departments/budget-alerts', as: 'admin', headers: JSON_CT, body: j({ month: '2026-03', department_name: 'Marketing', threshold: 120000 }) },
    { name: 'departments march after', path: '/api/departments?month=2026-03', as: 'admin' },
    { name: 'dashboard config bad', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: j({ date_range_start: '2026/01/01', formula_json: 5 }) },
    { name: 'dashboard config array', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: '[]' },
    { name: 'dashboard config bad json', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: '{' },
    { name: 'dashboard config bad formula', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: j({ date_range_start: '2026-01-01', date_range_end: '2026-12-31', formula_json: j({ op: 'field', name: 'total_expenses' }) }) },
    { name: 'dashboard config bad range', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: j({ date_range_start: '2026-12-01', date_range_end: '2026-01-31' }) },
    { name: 'dashboard config bad weights', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: j({ date_range_start: '2026-01-01', date_range_end: '2026-12-31', department_weight_json: j({ Sales: 'x' }) }) },
    { name: 'dashboard config form', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'date_range_start=2026-01-01&date_range_end=2026-06-30&formula_json=%7B%7D&department_weight_json=%7B%22Sales%22%3A2%7D' },
    { name: 'dashboard after form', path: '/api/dashboard', as: 'admin' },
    { name: 'dashboard config napi', method: 'POST', path: '/api/dashboard/config', as: 'admin', headers: JSON_CT, body: j({ date_range_start: '2026-01-01', date_range_end: '2026-12-31', formula_json: j({ op: 'add', left: { op: 'subtract', left: { op: 'field', name: 'revenue_amount' }, right: { op: 'multiply', left: { op: 'field', name: 'actual_expense_amount' }, right: { op: 'const', value: 0.1 } } }, right: { op: 'multiply', left: { op: 'subtract', left: { op: 'field', name: 'budget_amount' }, right: { op: 'field', name: 'actual_expense_amount' } }, right: { op: 'const', value: 0.05 } } }), department_weight_json: j({ Engineering: 1.0, Sales: 1.2, Marketing: 0.8 }) }) },
    { name: 'dashboard after napi', path: '/api/dashboard', as: 'admin' },
    { name: 'page dashboard after napi', path: '/dashboard', as: 'admin' },
    { name: 'order invalid', method: 'POST', path: '/api/portfolio/orders', as: 'admin', headers: JSON_CT, body: j({ asset_class_code: 'xx', direction: 'buy', amount: -1 }) },
    { name: 'order oversell', method: 'POST', path: '/api/portfolio/orders', as: 'admin', headers: JSON_CT, body: j({ asset_class_code: 'ca', direction: 'sell', amount: 1e9 }) },
    { name: 'order bad json', method: 'POST', path: '/api/portfolio/orders', as: 'admin', headers: JSON_CT, body: '{' },
    { name: 'order buy eq', method: 'POST', path: '/api/portfolio/orders', as: 'admin', headers: JSON_CT, body: j({ asset_class_code: 'eq', direction: 'buy', amount: 12500.25 }) },
    { name: 'order form sell fi', method: 'POST', path: '/api/portfolio/orders', as: 'admin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'asset_class_code=fi&direction=sell&amount=5000' },
    { name: 'portfolio page order ok', method: 'POST', path: '/portfolio', as: 'admin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'asset_class_code=al&direction=buy&amount=5000' },
    { name: 'portfolio page order bad', method: 'POST', path: '/portfolio', as: 'admin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'asset_class_code=al&direction=hold&amount=5' },
    { name: 'portfolio after', path: '/api/portfolio', as: 'admin' },
    { name: 'logout', method: 'POST', path: '/api/auth/logout', as: 'admin' },
  ],
}

/** A service under test: its base URL and its sessions' tokens. */
class Side {
  readonly tokens = new Map<string, string>()
  readonly base: string

  constructor(base: string) {
    this.base = base
  }

  async send(step: Step) {
    const headers: Record<string, string> = { ...step.headers }
    if (step.as !== undefined) {
      const [who, how] = step.as.split(':')
      const token = this.tokens.get(who!)
      if (token !== undefined) {
        if (how === 'bearer') headers.Authorization = `Bearer ${token}`
        else headers.Cookie = `token=${token}`
      }
    }
    const reply = await fetch(`${this.base}${step.path}`, {
      method: step.method ?? 'GET',
      headers,
      ...(step.body === undefined ? {} : { body: step.body }),
      redirect: 'manual',
    })
    const text = await reply.text()
    const cookie = reply.headers.get('set-cookie')
    const token = cookie === null ? undefined : /^token=([^;]*)/.exec(cookie)?.[1]
    if (step.login !== undefined && token) this.tokens.set(step.login, token)
    return { status: reply.status, type: reply.headers.get('content-type'), location: reply.headers.get('location'), cookie, text }
  }
}

/** A write's time: upstream's frozen `datetime('now')`, the fake's ticking clock. */
const STAMP = /2026-04-03 09:\d\d:\d\d/g
const unstamped = (text: string) => text.replace(STAMP, '<now>')

/** A Set-Cookie without its token's signature, and with `clock`, its times only as their span. */
function cookieShape(cookie: string | null, clock = false): string | null {
  if (cookie === null) return null
  return cookie.replace(/token=([^.;]+)\.([^.;]+)\.([^;]+)/, (_m, h: string, p: string) => {
    if (!clock) return `token=${h}.${p}.<signature>`
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, number>
    return `token=${h}.${JSON.stringify({ ...payload, iat: 0, exp: payload.exp! - payload.iat! })}.<signature>`
  })
}

/** Every table of a SQLite file but sqlite_sequence and the fake's `_env`, rows in order, times and salts masked. */
function tables(file: string): Record<string, string> {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('_env', 'sqlite_sequence')").all() as {
      name: string
    }[]
    const out: Record<string, string> = {}
    for (const { name } of names) {
      out[name] = unstamped(JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())).replace(
        /"password_hash":"[^"]*"/g,
        '"password_hash":"<hash>"',
      )
    }
    out.sqlite_sequence = JSON.stringify(db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all())
    return out
  } finally {
    db.close()
  }
}

/** The shared finance fake, seeded with each task's committed fixture. */
async function startFake(root: string): Promise<{ url: string; state: string; process: ChildProcess }> {
  for (const task of FINANCE) {
    mkdirSync(join(root, 'fixtures', 'finance'), { recursive: true })
    copyFileSync(join(TASKS, task, 'environment', 'fixtures', 'finance.json'), join(root, 'fixtures', 'finance', `${task}.json`))
  }
  const child = spawn(
    process.execPath,
    [join(HERE, 'fakes.ts'), '--service', 'finance', '--root', root, '--fixture', FINANCE[0]!, '--log', join(root, 'fake.log')],
    { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TZ: 'UTC' } },
  )
  for await (const line of createInterface({ input: child.stdout! })) {
    if (line.startsWith('FAKE=')) return { ...(JSON.parse(line.slice(5)) as { url: string; state: string }), process: child }
  }
  throw new Error('the finance fake exited before it was ready')
}

/** One task's comparison; the number of unexpected differences. */
async function compare(task: string, fake: { url: string; state: string }, scratch: string): Promise<number> {
  const runDir = join(scratch, task)
  const run = new Run(`compare-${task}`, runDir)
  const plan = liveclawbench.plan(join(PLATFORM, '..', 'tasks', task), run)
  const [spec] = plan.fakes
  // bun <serve.ts> ... becomes bun --preload frozen.ts <serve.ts> ...
  await start(
    {
      ...spec!,
      argv: [spec!.argv[0]!, '--preload', join(HERE, 'fixtures', 'frozen.ts'), ...spec!.argv.slice(1)],
      env: { ...spec!.env, TZ: 'UTC', FROZEN_EPOCH: EPOCH },
    },
    run,
  )
  const differ: string[] = []
  let same = 0
  let clocked = 0
  try {
    const name = task.replace(/[^A-Za-z0-9._-]/g, '-')
    const reset = await fetch(`${fake.url}/reset`, {
      method: 'POST',
      headers: JSON_CT,
      body: j({ run: name, fixture: task, epoch: EPOCH }),
    })
    if (!reset.ok) throw new Error(`resetting the fake's run for ${task}: ${reset.status} ${await reset.text()}`)
    const upstream = new Side(run.fakes.get(spec!.name)!.url)
    const ours = new Side(`${fake.url}/_run/${name}`)
    for (const [flow, steps] of Object.entries(FLOWS)) {
      for (const step of steps) {
        const a = await upstream.send(step)
        const b = await ours.send(step)
        const problems: string[] = []
        let byClock = false
        if (a.status !== b.status) problems.push(`status ${a.status} vs ${b.status}`)
        if (a.type !== b.type) problems.push(`content-type ${a.type} vs ${b.type}`)
        if (a.location !== b.location) problems.push(`location ${a.location} vs ${b.location}`)
        if (cookieShape(a.cookie) !== cookieShape(b.cookie)) {
          if (cookieShape(a.cookie, true) === cookieShape(b.cookie, true)) byClock = true
          else problems.push(`set-cookie ${cookieShape(a.cookie)} vs ${cookieShape(b.cookie)}`)
        }
        if (a.text !== b.text) {
          if (unstamped(a.text) === unstamped(b.text)) byClock = true
          else problems.push(`body\n      upstream: ${a.text.slice(0, 600)}\n      fake:     ${b.text.slice(0, 600)}`)
        }
        if (problems.length > 0) differ.push(`[${flow}] ${step.name} (${step.method ?? 'GET'} ${step.path})\n    ${problems.join('\n    ')}`)
        else if (byClock) clocked++
        else same++
      }
    }
    const theirs = tables(plan.state['/opt/mock/data/finance_app.sqlite']!)
    const kit = readdirSync(fake.state).find((e) => e.startsWith('mirage-kit-finance-'))!
    const mine = tables(join(fake.state, kit, `${name}.db`))
    for (const table of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      if (theirs[table] !== mine[table]) {
        differ.push(`table ${table}\n      upstream: ${theirs[table]?.slice(0, 600)}\n      fake:     ${mine[table]?.slice(0, 600)}`)
      }
    }
  } finally {
    await run.stop()
  }
  for (const line of differ) console.log(`DIFF ${task} ${line}`)
  console.log(`${differ.length === 0 ? 'ok' : 'FAIL'} ${task}: ${same} the same, ${clocked} the same but for the clock, ${differ.length} differ`)
  return differ.length
}

async function main(): Promise<number> {
  process.env.TZ = 'UTC'
  const tasks = process.argv.slice(2)
  for (const task of tasks) if (!FINANCE.includes(task)) throw new Error(`${task} is not a committed finance task`)
  const scratch = mkdtempSync(join(tmpdir(), 'vfsbench-compare-'))
  const fake = await startFake(join(scratch, 'fake'))
  let failed = 0
  try {
    for (const task of tasks.length > 0 ? tasks : FINANCE) failed += await compare(task, fake, scratch)
  } finally {
    fake.process.stdin!.end()
    await new Promise((resolve) => fake.process.once('exit', resolve))
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log(failed === 0 ? 'no unexpected differences' : `${failed} unexpected differences`)
  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
