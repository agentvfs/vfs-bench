/**
 * The contacts fake's routes: upstream's `server.py`, each statement kept,
 * over the run's lists. `contacts` is the fixture's contacts;
 * `sent_messages` is each message upstream records a send of.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict, Json } from '../claweval/store.ts'
import type { C } from './config.ts'

const SEARCH = { query: REQUIRED, department: opt(null) }
const GET = { contact_id: REQUIRED }
const SEND = { contact_id: REQUIRED, message: REQUIRED }

const copy = (c: Dict): Dict => structuredClone(c)

/** `c.get(key, default)`. */
const get = (c: Dict, key: string, fallback: Json): Json => (key in c ? c[key]! : fallback)

async function searchContacts(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SEARCH)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const c of await load(ctx.db, 'contacts')) {
    const q = String(req.query).toLowerCase()
    const searchable: Json[] = [get(c, 'name', ''), get(c, 'title', ''), get(c, 'department', '')]
    for (const key of ['skills', 'responsibilities']) {
      const val = get(c, key, [])
      if (Array.isArray(val)) searchable.push(...val)
    }
    for (const key of ['note', 'notes', 'specialization']) {
      const val = get(c, key, '')
      if (typeof val === 'string') searchable.push(val)
    }
    const textMatch = searchable.some((field) => Boolean(field) && String(field).toLowerCase().includes(q))
    const deptMatch = req.department === null || String(get(c, 'department', '')).includes(String(req.department))
    if (textMatch && deptMatch) results.push(copy(c))
  }
  const resp = { contacts: results, total: results.length }
  await logCall(ctx, '/contacts/search', req, resp)
  return ok(resp)
}

async function getContact(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const c of await load(ctx.db, 'contacts')) {
    if (c.contact_id === req.contact_id) {
      const resp = copy(c)
      await logCall(ctx, '/contacts/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Contact ${String(req.contact_id)} not found` }
  await logCall(ctx, '/contacts/get', req, resp)
  return ok(resp)
}

async function sendMessage(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SEND)
  if (isReply(req)) return req
  const record = {
    contact_id: req.contact_id!,
    message: req.message!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'sent_messages', record)
  const resp = { status: 'sent', record }
  await logCall(ctx, '/contacts/send_message', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), sent_messages: await load(ctx.db, 'sent_messages') })
}

export function contactsRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/contacts/search', searchContacts, { write: true }),
    route<C>('POST', '/contacts/get', getContact, { write: true }),
    route<C>('POST', '/contacts/send_message', sendMessage, { write: true }),
    route<C>('GET', '/contacts/audit', audit),
  ]
}
