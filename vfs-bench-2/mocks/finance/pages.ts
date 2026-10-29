/**
 * The finance fake's pages, rendered by upstream's own components
 * (mocks/finance/src/pages/*.tsx) with the rows upstream's `index.tsx`
 * hands them.
 *
 * The components are Hono JSX and take their rows as props. They are
 * bundled once with esbuild, Hono's JSX runtime from upstream's own
 * node_modules. Each page but `/` and `/login` is behind `authRequired`, as
 * upstream's `app.use(<path>, authRequired)` puts it: its JSON 401 without
 * a session.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { INTEG, UPSTREAM } from './config.ts'
import type { C } from './config.ts'
import {
  assetRows,
  computeDashboardMetrics,
  executePortfolioOrder,
  getEffectiveConfig,
  portfolioHoldings,
  signedIn,
} from './routes.ts'
import { optionalUser } from './session.ts'
import { INTERNAL, formBody, html, isReply, json, parseFormBody, redirect, rowId } from './wire.ts'

type Component = (props: Record<string, unknown>) => { toString(): string | Promise<string> }

/** Each page component, by its export, and the file upstream keeps it in. */
const COMPONENTS = {
  LoginPage: 'login',
  HomePage: 'home',
  DepartmentPage: 'department',
  TransactionPage: 'transaction',
  AccountPage: 'account',
  AccountDetailPage: 'account-detail',
  ExpenseCreatePage: 'expense',
  InvoiceCreatePage: 'invoice',
  AssetPage: 'asset',
  AssetEditPage: 'asset-edit',
  DashboardPage: 'dashboard',
  PortfolioPage: 'portfolio',
} as const

type Components = Record<keyof typeof COMPONENTS, Component>

/** The one esbuild call this makes. */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>
}

let bundled: Promise<Components> | undefined

/** Upstream's page components, bundled into one module. */
function components(): Promise<Components> {
  bundled ??= (async () => {
    // esbuild is tsx's, which runs every kit fake.
    const require = createRequire(createRequire(join(INTEG, 'package.json')).resolve('tsx/package.json'))
    const esbuild = require('esbuild') as Esbuild
    const source = join(UPSTREAM, 'src', 'pages')
    const entry = Object.entries(COMPONENTS)
      .map(([name, file]) => `export { ${name} } from ${JSON.stringify(join(source, `${file}.tsx`))}`)
      .join('\n')
    const out = await esbuild.build({
      stdin: { contents: entry, resolveDir: source, loader: 'ts' },
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      jsxImportSource: 'hono/jsx',
      write: false,
      logLevel: 'silent',
    })
    const dir = mkdtempSync(join(tmpdir(), 'vfsbench-finance-pages-'))
    try {
      const file = join(dir, 'pages.mjs')
      writeFileSync(file, out.outputFiles[0]!.text)
      return (await import(pathToFileURL(file).href)) as Components
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()
  return bundled
}

/** Hono's `c.html(<Page {...props} />)`. */
async function page(name: keyof Components, props: Record<string, unknown> = {}): Promise<Reply> {
  const render = (await components())[name]
  return html(String(await render(props).toString()))
}

/** A page behind `authRequired`; a handler that throws is mock-lib's 500. */
function guarded(handler: (ctx: Ctx<C>, userId: number | undefined) => Promise<Reply>) {
  return async (ctx: Ctx<C>): Promise<Reply> => {
    const user = signedIn(ctx)
    if (isReply(user)) return user
    try {
      return await handler(ctx, user.userId)
    } catch {
      return INTERNAL()
    }
  }
}

const NOT_FOUND = () => json(404, { error: 'Not found' })

async function portfolioPage(ctx: Ctx<C>, error?: string): Promise<Reply> {
  const holdings = await portfolioHoldings(ctx.db)
  const total_value = holdings.reduce((sum, h) => sum + (h.current_value ?? 0), 0)
  return page('PortfolioPage', { holdings, total_value, error })
}

export function pageRoutes(): KitRoute<C>[] {
  return [
    route<C>('GET', '/login', () => page('LoginPage')),
    route<C>('GET', '/', (ctx) => page('HomePage', { userId: optionalUser(ctx) })),
    route<C>(
      'GET',
      '/departments',
      guarded(async (ctx) => page('DepartmentPage', { departments: await ctx.db.departmentFinancialRecord.findMany({ orderBy: { id: 'asc' } }) })),
    ),
    route<C>(
      'GET',
      '/transactions',
      guarded(async (ctx) => page('TransactionPage', { transactions: await ctx.db.transactionRecord.findMany({ orderBy: { id: 'asc' } }) })),
    ),
    route<C>(
      'GET',
      '/accounts',
      guarded(async (ctx) => page('AccountPage', { accounts: await ctx.db.accountBalance.findMany({ orderBy: { id: 'asc' } }) })),
    ),
    route<C>(
      'GET',
      '/accounts/:id',
      guarded(async (ctx) => {
        const id = rowId(Number(ctx.params.id))
        const account = await ctx.db.accountBalance.findUnique({ where: { id } })
        if (account === null) return NOT_FOUND()
        const transactions = await ctx.db.accountTransaction.findMany({ where: { account_balance_id: id }, orderBy: { id: 'asc' } })
        return page('AccountDetailPage', { account, transactions })
      }),
    ),
    route<C>(
      'GET',
      '/expenses/new',
      guarded(() => page('ExpenseCreatePage')),
    ),
    route<C>(
      'GET',
      '/invoices/new',
      guarded(async (ctx) => page('InvoiceCreatePage', { vendors: await ctx.db.vendor.findMany({ orderBy: { id: 'asc' } }) })),
    ),
    route<C>(
      'GET',
      '/assets',
      guarded(async (ctx) => page('AssetPage', { assets: await assetRows(ctx.db) })),
    ),
    route<C>(
      'GET',
      '/assets/:id/edit',
      guarded(async (ctx) => {
        const [asset] = await assetRows(ctx.db, rowId(Number(ctx.params.id)))
        return asset === undefined ? NOT_FOUND() : page('AssetEditPage', { asset })
      }),
    ),
    route<C>(
      'GET',
      '/dashboard',
      guarded(async (ctx, userId) => {
        const user = userId === undefined ? null : await ctx.db.user.findUnique({ select: { role: true }, where: { id: rowId(userId) } })
        const config = await getEffectiveConfig(ctx.db, userId)
        const metrics = await computeDashboardMetrics(ctx.db, config)
        return page('DashboardPage', { config, kpis: metrics.kpis, monthly: metrics.monthly, isAdmin: user?.role === 'admin' })
      }),
    ),
    route<C>(
      'GET',
      '/portfolio',
      guarded((ctx) => portfolioPage(ctx, ctx.query.get('error') ?? undefined)),
    ),
    route<C>(
      'POST',
      '/portfolio',
      guarded(async (ctx) => {
        const contentType = typeof ctx.headers['content-type'] === 'string' ? ctx.headers['content-type'] : undefined
        const result = await executePortfolioOrder(ctx, parseFormBody(await formBody(contentType, ctx.body)))
        return result.success ? redirect('/portfolio') : portfolioPage(ctx, result.error)
      }),
      { write: true },
    ),
  ]
}
