/**
 * The finance fake's routes: upstream's `server.py`, each statement kept,
 * over the run's lists. `transactions` is the fixture's transactions;
 * `submitted_reports` is each expense report upstream records a submit of.
 */
import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { start_date: opt(null), end_date: opt(null) }
const GET = { transaction_id: REQUIRED }
const SUBMIT = { title: REQUIRED, transactions: opt([]), total_amount: opt(0.0), content: opt(null), report_type: opt(null) }

const copy = (t: Dict): Dict => structuredClone(t)

async function listTransactions(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const t of await load(ctx.db, 'transactions')) {
    if (req.start_date && String(t.date) < String(req.start_date)) continue
    if (req.end_date && String(t.date) > String(req.end_date)) continue
    results.push(copy(t))
  }
  const resp = { transactions: results, total: results.length }
  await logCall(ctx, '/finance/transactions', req, resp)
  return ok(resp)
}

async function getTransaction(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const t of await load(ctx.db, 'transactions')) {
    if (t.transaction_id === req.transaction_id) {
      const resp = copy(t)
      await logCall(ctx, '/finance/transactions/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Transaction ${String(req.transaction_id)} not found` }
  await logCall(ctx, '/finance/transactions/get', req, resp)
  return ok(resp)
}

async function submitReport(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SUBMIT)
  if (isReply(req)) return req
  const report = {
    title: req.title!,
    transactions: req.transactions!,
    total_amount: req.total_amount!,
    content: req.content!,
    report_type: req.report_type!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'submitted_reports', report)
  const resp = { status: 'submitted', report }
  await logCall(ctx, '/finance/report/submit', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), submitted_reports: await load(ctx.db, 'submitted_reports') })
}

export function financeRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/finance/transactions', listTransactions, { write: true }),
    route<C>('POST', '/finance/transactions/get', getTransaction, { write: true }),
    route<C>('POST', '/finance/report/submit', submitReport, { write: true }),
    route<C>('GET', '/finance/audit', audit),
  ]
}
