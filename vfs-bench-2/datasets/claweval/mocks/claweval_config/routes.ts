/**
 * The config fake's routes: upstream's `server.py`, each statement kept,
 * over the run's lists. `integrations` is the fixture's integrations;
 * `updates` and `notifications` are the records upstream keeps of each
 * update and notification.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow, save } from '../claweval/store.ts'
import type { Dict } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { status: opt(null), type: opt(null) }
const GET = { integration_id: REQUIRED }
const UPDATE = { integration_id: REQUIRED, status: opt(null), notes: opt(null) }
const NOTIFY = { to: REQUIRED, subject: REQUIRED, body: REQUIRED }

const copy = (d: Dict): Dict => structuredClone(d)

/** pydantic's `model_dump(exclude_none=True)`. */
const withoutNone = (req: Dict): Dict => Object.fromEntries(Object.entries(req).filter(([, v]) => v !== null))

async function listIntegrations(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const intg of await load(ctx.db, 'integrations')) {
    if (req.status && req.status !== 'all' && intg.status !== req.status) continue
    if (req.type && (intg.service ?? null) !== req.type) continue
    results.push({
      integration_id: intg.integration_id!,
      name: intg.name!,
      service: intg.service!,
      status: intg.status!,
      last_verified: intg.last_verified!,
      monthly_calls: intg.monthly_calls!,
      error_rate: intg.error_rate!,
    })
  }
  const resp = { integrations: results, total: results.length }
  await logCall(ctx, '/config/integrations', req, resp)
  return ok(resp)
}

async function getIntegration(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const intg of await load(ctx.db, 'integrations')) {
    if (intg.integration_id === req.integration_id) {
      const resp = copy(intg)
      await logCall(ctx, '/config/integrations/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Integration ${String(req.integration_id)} not found` }
  await logCall(ctx, '/config/integrations/get', req, resp)
  return ok(resp)
}

async function updateIntegration(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, UPDATE)
  if (isReply(req)) return req
  const integrations = await load(ctx.db, 'integrations')
  for (const intg of integrations) {
    if (intg.integration_id === req.integration_id) {
      if (req.status) intg.status = req.status
      if (req.notes) intg.notes = req.notes
      await save(ctx.db, 'integrations', integrations)
      const update = {
        integration_id: req.integration_id!,
        changes: withoutNone(req),
        timestamp: pyNow(ctx),
      }
      await append(ctx.db, 'updates', update)
      const resp = { status: 'updated', integration: copy(intg) }
      await logCall(ctx, '/config/integrations/update', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Integration ${String(req.integration_id)} not found` }
  await logCall(ctx, '/config/integrations/update', req, resp)
  return ok(resp)
}

async function notify(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, NOTIFY)
  if (isReply(req)) return req
  const record = {
    to: req.to!,
    subject: req.subject!,
    body: req.body!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'notifications', record)
  const resp = { status: 'sent', notification: record }
  await logCall(ctx, '/config/notify', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({
    calls: await calls(ctx.db),
    updates: await load(ctx.db, 'updates'),
    notifications: await load(ctx.db, 'notifications'),
  })
}

export function configRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/config/integrations', listIntegrations, { write: true }),
    route<C>('POST', '/config/integrations/get', getIntegration, { write: true }),
    route<C>('POST', '/config/integrations/update', updateIntegration, { write: true }),
    route<C>('POST', '/config/notify', notify, { write: true }),
    route<C>('GET', '/config/audit', audit),
  ]
}
