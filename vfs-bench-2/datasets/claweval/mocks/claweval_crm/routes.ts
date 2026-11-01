/**
 * The CRM fake's routes: upstream's `server.py`, each statement kept, over
 * the run's lists. `customers` is the fixture's customers;
 * `exported_reports` is each report upstream records an export of.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { status: opt(null), tier: opt(null), industry: opt(null) }
const GET = { customer_id: REQUIRED }
const EXPORT = { title: REQUIRED, customer_ids: REQUIRED, summary: REQUIRED }

const copy = (c: Dict): Dict => structuredClone(c)

async function listCustomers(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const c of await load(ctx.db, 'customers')) {
    if (req.status && req.status !== 'all' && c.status !== req.status) continue
    if (req.tier && c.tier !== req.tier) continue
    if (req.industry && c.industry !== req.industry) continue
    results.push({
      customer_id: c.customer_id!,
      name: c.name!,
      contact_person: c.contact_person!,
      tier: c.tier!,
      status: c.status!,
      industry: c.industry!,
      annual_revenue: c.annual_revenue!,
    })
  }
  const resp = { customers: results, total: results.length }
  await logCall(ctx, '/crm/customers', req, resp)
  return ok(resp)
}

async function getCustomer(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const c of await load(ctx.db, 'customers')) {
    if (c.customer_id === req.customer_id) {
      const resp = copy(c)
      await logCall(ctx, '/crm/customers/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Customer ${String(req.customer_id)} not found` }
  await logCall(ctx, '/crm/customers/get', req, resp)
  return ok(resp)
}

async function exportReport(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, EXPORT)
  if (isReply(req)) return req
  const report = {
    title: req.title!,
    customer_ids: req.customer_ids!,
    summary: req.summary!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'exported_reports', report)
  const resp = { status: 'exported', report }
  await logCall(ctx, '/crm/export', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), exported_reports: await load(ctx.db, 'exported_reports') })
}

export function crmRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/crm/customers', listCustomers, { write: true }),
    route<C>('POST', '/crm/customers/get', getCustomer, { write: true }),
    route<C>('POST', '/crm/export', exportReport, { write: true }),
    route<C>('GET', '/crm/audit', audit),
  ]
}
