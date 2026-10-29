/**
 * gaia2-cli's messaging apps, `messages` (apps/messages.py) and `chats`
 * (apps/chats.py), each command statement for statement over the run's
 * state. The two modules are the same program but for their `APP_NAME` and
 * one line of `_get_default_title`: in `chats` a participant with no name
 * is titled by their raw id (phone-number mode's number), in `messages`
 * left out. Both log under `MessagingAppV2` (`set_log_class`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { SequenceMatcher } from '../gaia2/difflib.ts'
import { osError } from '../gaia2/pyos.ts'
import { compile, search } from '../gaia2/pyre.ts'
import { pyStr, strRepr, typeName } from '../gaia2/pyrepr.ts'
import { strptime } from '../gaia2/pytime.ts'
import {
  CliError,
  PyError,
  PyFloat,
  exception,
  get,
  jsonLoads,
  num,
  sandboxPath,
  slice,
  sorted,
  str,
  truthy,
  valueError,
  type Call,
  type Command,
  type Py,
  type PyDict,
} from '../gaia2/store.ts'

const DATE_FORMAT = '%Y-%m-%d %H:%M:%S'

/** Python's `str.isspace()` characters. */
const SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const strip = (s: string) => s.replace(new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'gu'), '')

/** `str.isdigit()` of one character: Unicode decimals and the other digits (superscripts, circled, ...). */
const DIGIT =
  /^[\p{Nd}²³¹፩-፱᧚⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓪⓵-⓽⓿❶-❾➀-➈➊-➒\u{10a40}-\u{10a43}\u{1f100}-\u{1f10a}]$/u

/** `d[key]`: a KeyError where the key is missing. */
function item(d: PyDict, key: string): Py {
  if (!Object.hasOwn(d, key)) throw new PyError('KeyError', strRepr(key))
  return d[key]!
}

/** `iter(value)`'s items: a list's, a str's characters, a dict's keys. */
function iterate(value: Py): Py[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return Array.from(value)
  if (value !== null && typeof value === 'object' && !(value instanceof PyFloat)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

/** `len(value)`. */
function len(value: Py): number {
  if (typeof value === 'string' || Array.isArray(value)) return Array.isArray(value) ? value.length : Array.from(value).length
  if (value !== null && typeof value === 'object' && !(value instanceof PyFloat)) return Object.keys(value).length
  throw new PyError('TypeError', `object of type '${typeName(value)}' has no len()`)
}

/** A Python `set`'s identity of a value (`1 == 1.0 == True`), or a TypeError for an unhashable one. */
function hashKey(value: Py): string {
  if (typeof value === 'string') return `s${value}`
  if (value === null) return 'None'
  if (typeof value === 'boolean') return `n${Number(value)}`
  if (typeof value === 'number' || value instanceof PyFloat) return `n${num(value)}`
  throw new PyError('TypeError', `unhashable type: '${typeName(value)}'`)
}

/** A Python `set`, iterated in insertion order (upstream's order is arbitrary). */
class PySet {
  private readonly items = new Map<string, Py>()
  constructor(values: Iterable<Py> = []) {
    for (const v of values) this.add(v)
  }
  add(value: Py): void {
    const k = hashKey(value)
    if (!this.items.has(k)) this.items.set(k, value)
  }
  discard(value: Py): void {
    this.items.delete(hashKey(value))
  }
  get size(): number {
    return this.items.size
  }
  has(value: Py): boolean {
    return this.items.has(hashKey(value))
  }
  equals(other: PySet): boolean {
    return this.size === other.size && [...this.items.keys()].every((k) => other.items.has(k))
  }
  values(): Py[] {
    return [...this.items.values()]
  }
}

/** `key in d` for a dict: a TypeError for an unhashable key, and a str key only for a str. */
function inDict(d: PyDict, key: Py): boolean {
  hashKey(key)
  return typeof key === 'string' && Object.hasOwn(d, key)
}

/** `max(a, b)`: `a` unless `b` is greater. */
const max = (a: Py, b: Py): Py => (num(b) > num(a) ? b : a)

/** `datetime.strptime(x, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()`. */
const timestamp = (text: string): number => num(strptime(text, DATE_FORMAT).timestamp())

const conversationsOf = (state: PyDict) => item(state, 'conversations') as Record<string, PyDict>

/**
 * The messaging app's commands.
 *
 * Args:
 *   appName: upstream's `APP_NAME` (`Messages`, `Chats`).
 *   rawIdTitles: whether a default title names an unknown participant by
 *     their id (`chats`), or leaves them out (`messages`).
 */
export function messagingCommands(appName: string, rawIdTitles: boolean): () => Command[] {
  /** `_load_state`. */
  async function loadState(c: Call): Promise<PyDict> {
    const state = await c.state()
    if (!truthy(state)) throw new CliError(`State file for ${appName} not found`)
    return state
  }

  /** `_get_default_title`. */
  function defaultTitle(state: PyDict, userIds: Py): string {
    const currentUserId = item(state, 'current_user_id')
    const idToName = item(state, 'id_to_name') as PyDict
    const ids = new PySet(iterate(userIds))
    ids.discard(currentUserId)
    const names: string[] = []
    for (const uid of ids.values()) {
      if (inDict(idToName, uid)) names.push(idToName[uid as string] as string)
      else if (rawIdTitles) names.push(uid as string)
    }
    return sorted(names, (n) => n).join(', ')
  }

  /** `_get_messages_in_date_range`. */
  function inDateRange(messages: PyDict[], minDate: string | null, maxDate: string | null): PyDict[] {
    let start = -Infinity
    let end = Infinity
    if (minDate !== null) start = timestamp(minDate)
    if (maxDate !== null) end = timestamp(maxDate)
    return messages.filter((m) => {
      const t = Math.trunc(num(item(m, 'timestamp')))
      return start <= t && t <= end
    })
  }

  /** `_validate_user_ids`. */
  function validateUserIds(state: PyDict, userIds: Py): void {
    const mode = get(state, 'mode', 'NAME')
    for (const uid of iterate(userIds)) {
      if (mode === 'PHONE_NUMBER') {
        const chars = iterate(uid)
        const isDigit = (ch: Py) => {
          if (typeof ch !== 'string') throw new PyError('AttributeError', `'${typeName(ch)}' object has no attribute 'isdigit'`)
          return DIGIT.test(ch)
        }
        if (chars.every((ch) => !isDigit(ch))) {
          throw valueError(`User ${pyStr(uid)} is not a valid phone number, you need to provide the phone number of an existing user`)
        }
      } else if (!inDict(item(state, 'id_to_name') as PyDict, uid)) {
        throw valueError(`User ${pyStr(uid)} does not exist in Ids, you need to provide the Id of an existing user`)
      }
    }
  }

  /** `_get_or_create_default_conversation`. */
  function defaultConversation(c: Call, state: PyDict, userIds: Py[]): string {
    const currentUserId = item(state, 'current_user_id')
    const conversations = conversationsOf(state)
    const target = new PySet(userIds)
    target.add(currentUserId)
    const matching: string[] = []
    for (const [convId, conv] of Object.entries(conversations)) {
      if (new PySet(iterate(item(conv, 'participant_ids'))).equals(target)) matching.push(convId)
    }
    const title = defaultTitle(state, userIds)
    for (const convId of matching) {
      if (item(conversations[convId]!, 'title') === title) return convId
    }
    validateUserIds(state, userIds)
    const participants = target.values()
    const convId = c.uuidHex()
    conversations[convId] = {
      conversation_id: convId,
      title,
      participant_ids: new PySet(participants).values(),
      last_updated: c.now(),
      messages: [],
    }
    return convId
  }

  /** `_create_message`. */
  function createMessage(c: Call, state: PyDict, content: string, attachmentPath: string | null): PyDict {
    const msg: PyDict = {
      sender_id: item(state, 'current_user_id'),
      message_id: c.uuidHex(),
      timestamp: c.now(),
      content,
    }
    if (attachmentPath !== null) {
      const resolved = sandboxPath(c.drive(), attachmentPath)
      if (!existsSync(resolved)) throw valueError(`File ${attachmentPath} does not exist`)
      let data: Buffer
      try {
        data = readFileSync(resolved)
      } catch (error) {
        throw osError(error, resolved)
      }
      msg.attachment = data.toString('base64')
      msg.attachment_name = basename(resolved)
    }
    return msg
  }

  /** `_apply_conversation_limits`. */
  function applyLimits(conversations: PyDict[], viewLimit: number, offset: number, limit: number): PyDict[] {
    if (limit > viewLimit) {
      throw valueError(`Limit must be smaller than the view limit of ${pyStr(viewLimit)} - Please use a smaller limit and use offset to navigate`)
    }
    if (offset < 0) throw valueError('Offset must be non-negative')
    return conversations.map((conv) => {
      const messages = sorted(item(conv, 'messages') as PyDict[], (m) => num(item(m, 'timestamp')), true)
      const end = Math.min(messages.length, offset + limit)
      const trimmed = { ...conv }
      trimmed.messages = slice(messages, offset, end)
      return trimmed
    })
  }

  /** `_conversation_matches`. */
  function matches(conv: PyDict, query: string, minDate: string | null, maxDate: string | null): boolean {
    if ((item(conv, 'participant_ids') as string[]).some((p) => p.toLowerCase().includes(query))) return true
    if (truthy(get(conv, 'title')) && (conv.title as string).toLowerCase().includes(query)) return true
    const messages = inDateRange(item(conv, 'messages') as PyDict[], minDate, maxDate)
    return messages.some((m) => (get(m, 'content', '') as string).toLowerCase().includes(query))
  }

  /** `_regex_conversation_matches`. */
  function regexMatches(conv: PyDict, regex: RegExp, minDate: string | null, maxDate: string | null): boolean {
    if ((item(conv, 'participant_ids') as string[]).some((p) => search(regex, p.toLowerCase()))) return true
    if (truthy(get(conv, 'title')) && search(regex, (conv.title as string).toLowerCase())) return true
    const messages = inDateRange(item(conv, 'messages') as PyDict[], minDate, maxDate)
    return messages.some((m) => search(regex, get(m, 'content', '') as string))
  }

  /** `base64.b64decode(s)` (non-strict: characters outside the alphabet are skipped). */
  function b64decode(value: Py): Buffer {
    if (typeof value !== 'string') throw new PyError('TypeError', `argument should be a bytes-like object or ASCII string, not '${typeName(value)}'`)
    if (/[^\x00-\x7f]/.test(value)) throw valueError('string argument should contain only ASCII characters')
    const data = value.replace(/[^A-Za-z0-9+/=]/g, '')
    const body = data.replace(/=.*$/, '')
    if (body.length % 4 === 1) {
      throw new PyError('binascii.Error', `Invalid base64-encoded string: number of data characters (${body.length}) cannot be 1 more than a multiple of 4`)
    }
    const pad = (4 - (body.length % 4)) % 4
    if (pad > 0 && (data.slice(body.length).match(/=/g) ?? []).length < pad) throw new PyError('binascii.Error', 'Incorrect padding')
    return Buffer.from(body, 'base64')
  }

  /** `os.path.join(a, b)`. */
  const join = (a: string, b: string) => (b.startsWith('/') ? b : a.endsWith('/') || a === '' ? a + b : `${a}/${b}`)

  /** Run a command's body as upstream's `try: ... except Exception as e: cli_error(str(e))`. */
  async function guarded<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body()
    } catch (error) {
      throw new CliError(str(error))
    }
  }

  return () => [
    {
      name: 'get-user-id',
      async run(c) {
        const userName = c.str('user_name')!
        const state = await loadState(c)
        const result = get(item(state, 'name_to_id') as PyDict, userName, null)
        await c.log('get_user_id', { user_name: userName }, result)
        return result
      },
    },
    {
      name: 'get-user-name-from-id',
      async run(c) {
        const userId = c.str('user_id')!
        const state = await loadState(c)
        const result = get(item(state, 'id_to_name') as PyDict, userId, null)
        await c.log('get_user_name_from_id', { user_id: userId }, result)
        return result
      },
    },
    {
      name: 'lookup-user-id',
      async run(c) {
        const userName = c.str('user_name')!
        const state = await loadState(c)
        const nameToId = item(state, 'name_to_id') as PyDict
        let result: PyDict
        if (Object.hasOwn(nameToId, userName)) result = { [userName]: nameToId[userName]! }
        else {
          const query = strip(userName.toLowerCase())
          result = {}
          for (const [name, uid] of Object.entries(nameToId)) {
            const ratio = new SequenceMatcher(query, name.toLowerCase()).ratio()
            if (ratio > 0.65) result[name] = uid
          }
        }
        await c.log('lookup_user_id', { user_name: userName }, result)
        return result
      },
    },
    {
      name: 'send-message',
      async run(c) {
        const userId = c.str('user_id')!
        const content = c.str('content', '')!
        const attachmentPath = c.str('attachment_path')
        const state = await loadState(c)
        const result = await guarded(async () => {
          const msg = createMessage(c, state, content, attachmentPath)
          const convId = defaultConversation(c, state, [userId])
          const conv = conversationsOf(state)[convId]!
          ;(item(conv, 'messages') as Py[]).push(msg)
          conv.last_updated = max(msg.timestamp!, item(conv, 'last_updated'))
          await c.save(state)
          return convId
        })
        await c.log('send_message', { user_id: userId, content, attachment_path: attachmentPath }, result, true)
        return result
      },
    },
    {
      name: 'send-message-to-group-conversation',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const content = c.str('content', '')!
        const attachmentPath = c.str('attachment_path')
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw valueError(`Conversation ${conversationId} does not exist`)
          if (len(item(conversations[conversationId]!, 'participant_ids')) < 3) {
            throw valueError(`Conversation ${conversationId} is not a group conversation`)
          }
          const msg = createMessage(c, state, content, attachmentPath)
          const conv = conversations[conversationId]!
          ;(item(conv, 'messages') as Py[]).push(msg)
          conv.last_updated = max(msg.timestamp!, item(conv, 'last_updated'))
          await c.save(state)
          return conversationId
        })
        await c.log(
          'send_message_to_group_conversation',
          { conversation_id: conversationId, content, attachment_path: attachmentPath },
          result,
          true,
        )
        return result
      },
    },
    {
      name: 'create-group-conversation',
      async run(c) {
        const userIds = c.str('user_ids')!
        const title = c.str('title')
        const state = await loadState(c)
        let parsedIds: Py = null
        const result = await guarded(async () => {
          parsedIds = jsonLoads(userIds)
          if (len(parsedIds) < 2) throw exception('Must have at least two other participants')
          validateUserIds(state, parsedIds)
          const currentUserId = item(state, 'current_user_id')
          const participants = new PySet(iterate(parsedIds))
          participants.add(currentUserId)
          if (participants.size < 3) throw exception('Must have at least two other participants (do not include your own user id)')
          const convTitle = title === null ? defaultTitle(state, parsedIds) : title
          const convId = c.uuidHex()
          conversationsOf(state)[convId] = {
            conversation_id: convId,
            title: convTitle,
            participant_ids: participants.values(),
            last_updated: c.now(),
            messages: [],
          }
          await c.save(state)
          return convId
        })
        await c.log('create_group_conversation', { user_ids: parsedIds, title }, result, true)
        return result
      },
    },
    {
      name: 'get-existing-conversation-ids',
      async run(c) {
        const userIds = c.str('user_ids')!
        const state = await loadState(c)
        const parsedIds = jsonLoads(userIds)
        const currentUserId = item(state, 'current_user_id')
        const target = new PySet(iterate(parsedIds))
        target.add(currentUserId)
        const result: string[] = []
        for (const [convId, conv] of Object.entries(conversationsOf(state))) {
          if (new PySet(iterate(item(conv, 'participant_ids'))).equals(target)) result.push(convId)
        }
        await c.log('get_existing_conversation_ids', { user_ids: parsedIds }, result)
        return result
      },
    },
    {
      name: 'list-recent-conversations',
      async run(c) {
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 5)!
        const offsetMessages = c.int('offset_recent_messages_per_conversation', 0)!
        const limitMessages = c.int('limit_recent_messages_per_conversation', 10)!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const convViewLimit = get(state, 'conversation_view_limit', 5) as number
          const msgViewLimit = get(state, 'messages_view_limit', 10) as number
          if (limit > convViewLimit) {
            throw valueError(`Limit must be smaller than the view limit of ${pyStr(convViewLimit)} - Please use a smaller limit and use offset to navigate`)
          }
          if (offset < 0) throw valueError('Offset must be non-negative')
          const conversations = Object.values(conversationsOf(state))
          if (offset > conversations.length) throw valueError('Offset is larger than the number of conversations')
          const byRecent = sorted(conversations, (conv) => num(item(conv, 'last_updated')), true)
          const end = Math.min(byRecent.length, offset + limit)
          return applyLimits(slice(byRecent, offset, end), msgViewLimit, offsetMessages, limitMessages)
        })
        const args = {
          offset,
          limit,
          offset_recent_messages_per_conversation: offsetMessages,
          limit_recent_messages_per_conversation: limitMessages,
        }
        await c.log('list_recent_conversations', args, result)
        return result
      },
    },
    {
      name: 'list-conversations-by-participant',
      async run(c) {
        const userId = c.str('user_id')!
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 5)!
        const offsetMessages = c.int('offset_recent_messages_per_conversation', 0)!
        const limitMessages = c.int('limit_recent_messages_per_conversation', 5)!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const convViewLimit = get(state, 'conversation_view_limit', 5) as number
          const msgViewLimit = get(state, 'messages_view_limit', 10) as number
          if (limit > convViewLimit) {
            throw valueError(`Limit must be smaller than the view limit of ${pyStr(convViewLimit)} - Please use a smaller limit and use offset to navigate`)
          }
          if (offset < 0) throw valueError('Offset must be non-negative')
          const conversations = Object.values(conversationsOf(state))
          if (offset > conversations.length) throw valueError('Offset is larger than the number of conversations')
          const matching = conversations.filter((conv) => (item(conv, 'participant_ids') as string[]).some((pid) => pid.includes(userId)))
          const end = Math.min(matching.length, offset + limit)
          return applyLimits(slice(matching, offset, end), msgViewLimit, offsetMessages, limitMessages)
        })
        const args = {
          user_id: userId,
          offset,
          limit,
          offset_recent_messages_per_conversation: offsetMessages,
          limit_recent_messages_per_conversation: limitMessages,
        }
        await c.log('list_conversations_by_participant', args, result)
        return result
      },
    },
    {
      name: 'download-attachment',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const messageId = c.str('message_id')!
        const downloadPath = c.str('download_path', 'Downloads/')!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw exception(`Conversation with id ${conversationId} not found`)
          const conv = conversations[conversationId]!
          const message = (item(conv, 'messages') as PyDict[]).find((m) => item(m, 'message_id') === messageId) ?? null
          if (message === null || !Object.hasOwn(message, 'attachment') || !truthy(message.attachment)) {
            throw exception('No attachment found in the specified message')
          }
          const fileData = b64decode(message.attachment!)
          const resolvedDir = sandboxPath(c.drive(), downloadPath)
          const fullPath = join(resolvedDir, item(message, 'attachment_name') as string)
          const dir = dirname(fullPath) || resolvedDir
          try {
            mkdirSync(dir, { recursive: true })
          } catch (error) {
            throw osError(error, dir)
          }
          try {
            writeFileSync(fullPath, fileData)
          } catch (error) {
            throw osError(error, fullPath)
          }
          return fullPath
        })
        await c.log('download_attachment', { conversation_id: conversationId, message_id: messageId, download_path: downloadPath }, result, true)
        return result
      },
    },
    {
      name: 'read-conversation',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 10)!
        const minDate = c.str('min_date')
        const maxDate = c.str('max_date')
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw valueError(`Conversation with id ${conversationId} not found`)
          if (offset < 0) throw valueError('Offset must be positive')
          const conv = conversations[conversationId]!
          let messages = inDateRange(item(conv, 'messages') as PyDict[], minDate, maxDate)
          if (offset > messages.length) throw valueError('Offset is larger than the number of messages')
          messages = sorted(messages, (m) => num(item(m, 'timestamp')), true)
          const conversationLength = messages.length
          const end = Math.min(messages.length, offset + limit)
          return {
            messages: slice(messages, offset, end),
            metadata: {
              message_range: [offset, end],
              conversation_length: conversationLength,
              conversation_id: conversationId,
              conversation_title: item(conv, 'title'),
            },
          }
        })
        const args = { conversation_id: conversationId, offset, limit, min_date: minDate, max_date: maxDate }
        await c.log('read_conversation', args, result)
        return result
      },
    },
    {
      name: 'add-participant-to-conversation',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const userId = c.str('user_id')!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw exception(`Conversation with id ${conversationId} not found`)
          const conv = conversations[conversationId]!
          const participants = item(conv, 'participant_ids') as Py[]
          if (participants.includes(userId)) throw exception(`Participant ${userId} already in conversation`)
          const oldDefault = defaultTitle(state, participants)
          const updateTitle = item(conv, 'title') === oldDefault
          participants.push(userId)
          if (updateTitle) conv.title = defaultTitle(state, participants)
          await c.save(state)
          return conversationId
        })
        await c.log('add_participant_to_conversation', { conversation_id: conversationId, user_id: userId }, result, true)
        return result
      },
    },
    {
      name: 'remove-participant-from-conversation',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const userId = c.str('user_id')!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw exception(`Conversation with id ${conversationId} not found`)
          const conv = conversations[conversationId]!
          const participants = item(conv, 'participant_ids') as Py[]
          if (!participants.includes(userId)) throw exception(`Participant ${userId} not in conversation`)
          const oldDefault = defaultTitle(state, participants)
          const updateTitle = item(conv, 'title') === oldDefault
          participants.splice(participants.indexOf(userId), 1)
          if (updateTitle) conv.title = defaultTitle(state, participants)
          await c.save(state)
          return conversationId
        })
        await c.log('remove_participant_from_conversation', { conversation_id: conversationId, user_id: userId }, result, true)
        return result
      },
    },
    {
      name: 'change-conversation-title',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const title = c.str('title')!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw exception(`Conversation with id ${conversationId} not found`)
          conversations[conversationId]!.title = title
          await c.save(state)
          return conversationId
        })
        await c.log('change_conversation_title', { conversation_id: conversationId, title }, result, true)
        return result
      },
    },
    {
      name: 'search',
      async run(c) {
        const query = c.str('query')!
        const minDate = c.str('min_date')
        const maxDate = c.str('max_date')
        const state = await loadState(c)
        const q = query.toLowerCase()
        const results: Py[] = []
        for (const conv of Object.values(conversationsOf(state))) {
          if (matches(conv, q, minDate, maxDate)) results.push(item(conv, 'conversation_id'))
        }
        await c.log('search', { query, min_date: minDate, max_date: maxDate }, results)
        return results
      },
    },
    {
      name: 'regex-search',
      async run(c) {
        const query = c.str('query')!
        const minDate = c.str('min_date')
        const maxDate = c.str('max_date')
        const state = await loadState(c)
        const compiled = compile(query, { ignorecase: true })
        const results: Py[] = []
        for (const conv of Object.values(conversationsOf(state))) {
          if (regexMatches(conv, compiled, minDate, maxDate)) results.push(item(conv, 'conversation_id'))
        }
        await c.log('regex_search', { query, min_date: minDate, max_date: maxDate }, results)
        return results
      },
    },
    {
      name: 'create-and-add-message',
      async run(c) {
        const conversationId = c.str('conversation_id')!
        const senderId = c.str('sender_id')!
        const content = c.str('content', '')!
        const state = await loadState(c)
        const result = await guarded(async () => {
          const conversations = conversationsOf(state)
          if (!Object.hasOwn(conversations, conversationId)) throw exception(`Conversation with id ${conversationId} not found`)
          const conv = conversations[conversationId]!
          if (!(item(conv, 'participant_ids') as Py[]).includes(senderId)) throw exception(`Sender ${senderId} not in conversation`)
          const msg: PyDict = { sender_id: senderId, message_id: c.uuidHex(), timestamp: c.now(), content }
          ;(item(conv, 'messages') as Py[]).push(msg)
          conv.last_updated = max(msg.timestamp!, item(conv, 'last_updated'))
          await c.save(state)
          return conversationId
        })
        await c.log('create_and_add_message', { conversation_id: conversationId, sender_id: senderId, content }, result, true)
        return result
      },
    },
  ]
}

export const APP_NAME = 'Messages'

/** The `messages` app's commands. */
export const commands = messagingCommands(APP_NAME, false)
