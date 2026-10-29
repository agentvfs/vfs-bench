/**
 * The helpdesk fake's routes: upstream's `server.py`, each statement kept,
 * over the run's lists. `tickets` is the fixture's tickets; `closed` and
 * `updated_tickets` are the copies upstream keeps of each close and update.
 */
import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, save } from '../claweval/store.ts'
import type { Dict } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = {
  status: opt('open'),
  priority: opt(null),
  category: opt(null),
  date_from: opt(null),
  date_to: opt(null),
}
const GET = { ticket_id: REQUIRED }
const UPDATE = { ticket_id: REQUIRED, priority: opt(null), tags: opt(null), category: opt(null), assigned_to: opt(null) }
const CLOSE = { ticket_id: REQUIRED, resolution: REQUIRED }

const copy = (t: Dict): Dict => structuredClone(t)

async function listTickets(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const t of await load(ctx.db, 'tickets')) {
    if (req.status === 'all' || t.status === req.status) {
      if (req.priority && t.priority !== req.priority) continue
      if (req.category && t.category !== req.category) continue
      if (req.date_from && String(t.created_at ?? '') < String(req.date_from)) continue
      if (req.date_to && String(t.created_at ?? '') > String(req.date_to)) continue
      results.push({
        ticket_id: t.ticket_id!,
        title: t.title!,
        reporter: t.reporter!,
        department: t.department!,
        priority: t.priority!,
        status: t.status!,
        created_at: t.created_at!,
      })
    }
  }
  const resp = { tickets: results, total: results.length }
  await logCall(ctx, '/helpdesk/tickets', req, resp)
  return ok(resp)
}

async function getTicket(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const t of await load(ctx.db, 'tickets')) {
    if (t.ticket_id === req.ticket_id) {
      const resp = copy(t)
      await logCall(ctx, '/helpdesk/tickets/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Ticket ${String(req.ticket_id)} not found` }
  await logCall(ctx, '/helpdesk/tickets/get', req, resp)
  return ok(resp)
}

async function updateTicket(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, UPDATE)
  if (isReply(req)) return req
  const tickets = await load(ctx.db, 'tickets')
  for (const t of tickets) {
    if (t.ticket_id === req.ticket_id) {
      if (req.priority !== null) t.priority = req.priority!
      if (req.tags !== null) t.tags = req.tags!
      if (req.category !== null) t.category = req.category!
      if (req.assigned_to !== null) t.assigned_to = req.assigned_to!
      await save(ctx.db, 'tickets', tickets)
      const updated = copy(t)
      await append(ctx.db, 'updated_tickets', updated)
      const resp = { status: 'updated', ticket: updated }
      await logCall(ctx, '/helpdesk/tickets/update', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Ticket ${String(req.ticket_id)} not found` }
  await logCall(ctx, '/helpdesk/tickets/update', req, resp)
  return ok(resp)
}

async function closeTicket(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, CLOSE)
  if (isReply(req)) return req
  const tickets = await load(ctx.db, 'tickets')
  for (const t of tickets) {
    if (t.ticket_id === req.ticket_id) {
      t.status = 'closed'
      t.resolution = req.resolution!
      await save(ctx.db, 'tickets', tickets)
      await append(ctx.db, 'closed', copy(t))
      const resp = { status: 'closed', ticket: copy(t) }
      await logCall(ctx, '/helpdesk/tickets/close', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Ticket ${String(req.ticket_id)} not found` }
  await logCall(ctx, '/helpdesk/tickets/close', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), closed: await load(ctx.db, 'closed'), updated_tickets: await load(ctx.db, 'updated_tickets') })
}

export function helpdeskRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/helpdesk/tickets', listTickets, { write: true }),
    route<C>('POST', '/helpdesk/tickets/get', getTicket, { write: true }),
    route<C>('POST', '/helpdesk/tickets/update', updateTicket, { write: true }),
    route<C>('POST', '/helpdesk/tickets/close', closeTicket, { write: true }),
    route<C>('GET', '/helpdesk/audit', audit),
  ]
}
