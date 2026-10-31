/**
 * gaia2-cli's `emails` app (apps/email.py, EmailClientV2), each command
 * statement for statement over the run's state.
 *
 * The state keeps each folder's emails as a list, newest first; a command
 * works on them as upstream's `_load_state` does, a dict per folder keyed by
 * `email_id` (a `Map` here, so an id's place is its insertion, whatever its
 * digits), and `_save_state` writes every folder back sorted by timestamp,
 * newest first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { osError } from '../gaia2/pyos.ts'
import { pyStr, typeName } from '../gaia2/pyrepr.ts'
import {
  CliError,
  PyError,
  PyFloat,
  UsageError,
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

const APP_NAME = 'EmailClientV2'
export { APP_NAME }

const DEFAULT_USER_EMAIL = 'user@example.com'
// A Python set upstream, whose order is arbitrary: this one's is the scenarios'.
const VALID_FOLDERS = ['INBOX', 'SENT', 'DRAFT', 'TRASH']

type Folder = Map<Py, PyDict>

/** The state as `_load_state` leaves it: its folders as dicts of emails by id. */
interface Loaded {
  state: PyDict
  /** `state["folders"]`, or `None` where the state has no folders dict (a fresh `{}` each time upstream). */
  folders: Map<string, Folder> | null
}

const isDict = (v: unknown): v is PyDict => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyFloat)

/** `for x in value`, for a value JSON gives: a list's items, a dict's keys, a str's characters. */
function iterate(value: Py): Py[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [...value]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

/** `value.lower()`. */
function lower(value: Py): string {
  if (typeof value !== 'string') throw new PyError('AttributeError', `'${typeName(value)}' object has no attribute 'lower'`)
  return value.toLowerCase()
}

/** `prefix + value`, a str and whatever the email holds. */
function concat(prefix: string, value: Py): string {
  if (typeof value !== 'string') throw new PyError('TypeError', `can only concatenate str (not "${typeName(value)}") to str`)
  return prefix + value
}

/** A required option, or click's error where it is missing. */
function need(c: Call, name: string, spellings: string): string {
  const value = c.str(name)
  if (value === null) throw new UsageError(`Missing option ${spellings}.`)
  return value
}

/** `_parse_json_list`, whose `click.BadParameter` is a usage error. */
function parseJsonList(value: string | null): string[] {
  if (value === null) return []
  let parsed: Py
  try {
    parsed = jsonLoads(value)
  } catch (error) {
    if (error instanceof PyError) throw new UsageError(`Invalid value: Invalid JSON list: ${value}`)
    throw error
  }
  if (!Array.isArray(parsed)) {
    // `NaN` and `Infinity` read as floats upstream (jsonLoads gives null).
    const kind = parsed === null && value.trim() !== 'null' ? 'float' : typeName(parsed)
    throw new UsageError(`Invalid value: Expected a JSON list, got: ${kind}`)
  }
  return parsed.map(pyStr)
}

/** `validate_email_list`. */
function validateEmailList(values: string[], param: string): void {
  for (const v of values) {
    if (!v.includes('@')) throw valueError(`'${v}' is not a valid email address for ${param}.`)
  }
}

/** `_default_state`. */
function defaultState(): PyDict {
  return {
    user_email: DEFAULT_USER_EMAIL,
    view_limit: 5,
    folders: Object.fromEntries(VALID_FOLDERS.map((f) => [f, { folder_name: f, emails: [] }])),
  }
}

/** `_load_state`. */
async function loadState(c: Call): Promise<Loaded> {
  let state = await c.state()
  if (!truthy(state)) state = defaultState()
  if (!Object.hasOwn(state, 'folders')) return { state, folders: null }
  const raw = state.folders
  if (!isDict(raw)) throw new PyError('AttributeError', `'${typeName(raw)}' object has no attribute 'keys'`)
  const folders = new Map<string, Folder>()
  for (const fname of Object.keys(raw)) {
    const folderObj = raw[fname]!
    const emailsList = isDict(folderObj) ? get(folderObj, 'emails', []) : []
    const folder: Folder = new Map()
    for (const e of iterate(emailsList)) {
      if (isDict(e) && truthy(get(e, 'email_id'))) folder.set(e.email_id!, e)
    }
    folders.set(fname, folder)
  }
  return { state, folders }
}

/** `_sorted_emails`: newest first, ties in the folder's order. */
const sortedEmails = (folder: Folder): PyDict[] => sorted(folder.values(), (e) => num(get(e, 'timestamp', 0)), true)

/** `_save_state`. */
async function saveState(c: Call, loaded: Loaded): Promise<void> {
  const saveCopy: PyDict = { ...loaded.state }
  const out: PyDict = {}
  saveCopy.folders = out
  for (const [fname, emails] of loaded.folders ?? []) out[fname] = { folder_name: fname, emails: sortedEmails(emails) }
  await c.save(saveCopy)
}

/** `_get_folder`. */
function getFolder(loaded: Loaded, folderName: string): Folder {
  const name = folderName.toUpperCase()
  const folder = loaded.folders?.get(name)
  if (folder === undefined) throw valueError(`Folder ${name} not found`)
  return folder
}

/** `_find_email`: the email and its folder's name. */
function findEmail(loaded: Loaded, emailId: Py, folderName: string | null = null): [PyDict, string] {
  if (truthy(folderName)) {
    const folder = getFolder(loaded, folderName!)
    if (folder.has(emailId)) return [folder.get(emailId)!, folderName!.toUpperCase()]
    throw valueError(`Email with id ${pyStr(emailId)} does not exist in ${folderName}`)
  }
  for (const [fname, folder] of loaded.folders ?? []) {
    if (folder.has(emailId)) return [folder.get(emailId)!, fname]
  }
  throw valueError(`Email with id ${pyStr(emailId)} does not exist`)
}

/** `os.path.join(a, b)`. */
const joinPath = (a: string, b: string): string => (b.startsWith('/') ? b : a === '' || a.endsWith('/') ? a + b : `${a}/${b}`)

/** The attachments dict of the files at `paths`: `{basename: base64}`. */
function readAttachments(c: Call, paths: string[]): PyDict {
  const attachments: PyDict = {}
  for (const path of paths) {
    const resolved = sandboxPath(c.drive(), path)
    if (!existsSync(resolved)) throw valueError(`File does not exist: ${path}`)
    let data: Buffer
    try {
      data = readFileSync(resolved)
    } catch (error) {
      throw osError(error, resolved)
    }
    attachments[resolved.slice(resolved.lastIndexOf('/') + 1)] = data.toString('base64')
  }
  return attachments
}

/** A command's body under upstream's `try: ... except Exception as e: cli_error(str(e))`. */
async function guarded<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (error) {
    throw new CliError(str(error))
  }
}

const folderOption = (c: Call) => c.str('folder_name', 'INBOX')!

export function commands(): Command[] {
  return [
    {
      name: 'list-emails',
      async run(c) {
        const folderName = folderOption(c)
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 10)!
        return guarded(async () => {
          const loaded = await loadState(c)
          const emails = sortedEmails(getFolder(loaded, folderName))
          const total = emails.length
          if (offset < 0) throw valueError('Offset must be non-negative')
          if (offset > total) throw valueError('Offset must be less than the number of emails')
          const end = Math.min(offset + limit, total)
          const page = slice(emails, offset, end)
          const result = { emails: page, emails_range: [offset, end], total_returned_emails: page.length, total_emails: total }
          await c.log('list_emails', { folder_name: folderName.toUpperCase(), offset, limit }, result)
          return result
        })
      },
    },
    {
      name: 'get-email-by-id',
      async run(c) {
        const emailId = need(c, 'email_id', "'--email-id'")
        const folderName = folderOption(c)
        return guarded(async () => {
          const loaded = await loadState(c)
          const folder = getFolder(loaded, folderName)
          if (!folder.has(emailId)) throw valueError(`Email with id ${emailId} does not exist`)
          const email = folder.get(emailId)!
          email.is_read = true
          await saveState(c, loaded)
          await c.log('get_email_by_id', { email_id: emailId, folder_name: folderName.toUpperCase() }, email)
          return email
        })
      },
    },
    {
      name: 'get-email-by-index',
      async run(c) {
        if (c.args.idx === undefined || c.args.idx === null) throw new UsageError("Missing option '--idx'.")
        const idx = c.int('idx')!
        const folderName = folderOption(c)
        return guarded(async () => {
          const loaded = await loadState(c)
          const emails = sortedEmails(getFolder(loaded, folderName))
          if (idx < 0 || idx >= emails.length) throw valueError(`Email with index ${idx} does not exist`)
          const email = emails[idx]!
          email.is_read = true
          await saveState(c, loaded)
          await c.log('get_email_by_index', { idx, folder_name: folderName.toUpperCase() }, email)
          return email
        })
      },
    },
    {
      name: 'send-email',
      async run(c) {
        const recipients = need(c, 'recipients', "'--recipients'")
        const subject = c.str('subject', '')!
        const content = c.str('content', '')!
        const cc = c.str('cc')
        const attachmentPaths = c.str('attachment_paths')
        const parsedRecipients = parseJsonList(recipients)
        const parsedCc = parseJsonList(cc)
        const parsedAttachments = parseJsonList(attachmentPaths)
        return guarded(async () => {
          validateEmailList(parsedRecipients, 'recipients')
          validateEmailList(parsedCc, 'cc')
          const loaded = await loadState(c)
          const userEmail = get(loaded.state, 'user_email', DEFAULT_USER_EMAIL)
          const attachments = readAttachments(c, parsedAttachments)
          const emailId = c.uuidHex()
          const emailObj: PyDict = {
            sender: userEmail,
            recipients: parsedRecipients,
            subject,
            content,
            email_id: emailId,
            parent_id: null,
            cc: parsedCc,
            attachments,
            timestamp: c.now(),
            is_read: true,
          }
          getFolder(loaded, 'SENT').set(emailId, emailObj)
          await saveState(c, loaded)
          const args = { recipients: parsedRecipients, subject, content, cc: parsedCc, attachment_paths: parsedAttachments }
          await c.log('send_email', args, emailId, true)
          return { status: 'ok', email_id: emailId }
        })
      },
    },
    {
      name: 'forward-email',
      async run(c) {
        const emailId = need(c, 'email_id', "'--email-id'")
        const recipients = need(c, 'recipients', "'--recipients'")
        const folderName = folderOption(c)
        const parsedRecipients = parseJsonList(recipients)
        return guarded(async () => {
          validateEmailList(parsedRecipients, 'recipients')
          const loaded = await loadState(c)
          const userEmail = get(loaded.state, 'user_email', DEFAULT_USER_EMAIL)
          const folder = getFolder(loaded, folderName)
          if (!folder.has(emailId)) throw valueError(`Email with id ${emailId} does not exist`)
          const original = folder.get(emailId)!
          const newId = c.uuidHex()
          const forwarded: PyDict = {
            sender: userEmail,
            recipients: parsedRecipients,
            subject: concat('FWD: ', get(original, 'subject', '')),
            content: concat('> ', get(original, 'content', '')),
            email_id: newId,
            parent_id: emailId,
            cc: [],
            attachments: get(original, 'attachments', {}),
            timestamp: c.now(),
            is_read: true,
          }
          getFolder(loaded, 'SENT').set(newId, forwarded)
          await saveState(c, loaded)
          const args = { email_id: emailId, recipients: parsedRecipients, folder_name: folderName.toUpperCase() }
          await c.log('forward_email', args, newId, true)
          return { status: 'ok', email_id: newId }
        })
      },
    },
    {
      name: 'download-attachments',
      async run(c) {
        const emailId = need(c, 'email_id', "'--email-id'")
        const folderName = folderOption(c)
        const pathToSave = c.str('path_to_save', 'Downloads/')!
        return guarded(async () => {
          const loaded = await loadState(c)
          const [email] = findEmail(loaded, emailId, folderName)
          const attachments = get(email, 'attachments', {})
          const filenames: string[] = []
          if (truthy(attachments) && isDict(attachments)) {
            const resolvedDir = sandboxPath(c.drive(), pathToSave)
            try {
              mkdirSync(resolvedDir, { recursive: true })
            } catch (error) {
              throw osError(error)
            }
            for (const [filename, b64Content] of Object.entries(attachments)) {
              const fullPath = joinPath(resolvedDir, filename)
              try {
                writeFileSync(fullPath, Buffer.from(String(b64Content), 'base64'))
              } catch (error) {
                throw osError(error, fullPath)
              }
              filenames.push(fullPath)
            }
          }
          const args = { email_id: emailId, folder_name: folderName.toUpperCase(), path_to_save: pathToSave }
          await c.log('download_attachments', args, filenames, true)
          return { status: 'ok', downloaded: filenames }
        })
      },
    },
    {
      name: 'reply-to-email',
      async run(c) {
        const emailId = need(c, 'email_id', "'--email-id'")
        const content = c.str('content', '')!
        const folderName = folderOption(c)
        const attachmentPaths = c.str('attachment_paths')
        const parsedAttachments = parseJsonList(attachmentPaths)
        return guarded(async () => {
          const loaded = await loadState(c)
          const userEmail = get(loaded.state, 'user_email', DEFAULT_USER_EMAIL)
          const folder = getFolder(loaded, folderName)
          if (!folder.has(emailId)) throw valueError(`Email with id ${emailId} does not exist`)
          const original = folder.get(emailId)!
          // Walk the parent chain while the sender is the user.
          let recipient = get(original, 'sender', '')
          let parent = original
          const seen = new Set<PyDict>()
          while (get(parent, 'sender') === userEmail && truthy(get(parent, 'parent_id'))) {
            // A chain that loops would spin forever upstream; this stops it.
            if (seen.has(parent)) throw valueError(`Email with id ${pyStr(parent.parent_id!)} is its own ancestor`)
            seen.add(parent)
            ;[parent] = findEmail(loaded, parent.parent_id!)
            recipient = get(parent, 'sender', recipient)
          }
          const attachments = readAttachments(c, parsedAttachments)
          const newId = c.uuidHex()
          const reply: PyDict = {
            sender: userEmail,
            recipients: [recipient],
            subject: concat('Re: ', get(original, 'subject', '')),
            content,
            email_id: newId,
            parent_id: emailId,
            cc: [],
            attachments,
            timestamp: c.now(),
            is_read: true,
          }
          getFolder(loaded, 'SENT').set(newId, reply)
          await saveState(c, loaded)
          const args = { email_id: emailId, folder_name: folderName.toUpperCase(), content, attachment_paths: parsedAttachments }
          await c.log('reply_to_email', args, newId, true)
          return { status: 'ok', email_id: newId }
        })
      },
    },
    {
      name: 'move-email',
      async run(c) {
        const emailId = need(c, 'email_id', "'--email-id'")
        const sourceFolderName = need(c, 'source_folder_name', "'--source-folder-name' / '--source-folder'")
        const destFolderName = need(c, 'dest_folder_name', "'--dest-folder-name' / '--dest-folder'")
        return guarded(async () => {
          const loaded = await loadState(c)
          const src = getFolder(loaded, sourceFolderName)
          const dst = getFolder(loaded, destFolderName)
          if (!src.has(emailId)) throw valueError(`Email with id ${emailId} does not exist in ${sourceFolderName}`)
          const email = src.get(emailId)!
          src.delete(emailId)
          dst.set(emailId, email)
          await saveState(c, loaded)
          const args = {
            email_id: emailId,
            source_folder_name: sourceFolderName.toUpperCase(),
            dest_folder_name: destFolderName.toUpperCase(),
          }
          await c.log('move_email', args, emailId, true)
          return { status: 'ok', email_id: emailId }
        })
      },
    },
    {
      name: 'delete-email',
      async run(c) {
        const emailId = need(c, 'email_id', "'--email-id'")
        const folderName = folderOption(c)
        return guarded(async () => {
          const loaded = await loadState(c)
          const src = getFolder(loaded, folderName)
          const trash = getFolder(loaded, 'TRASH')
          if (!src.has(emailId)) throw valueError(`Email with id ${emailId} does not exist in ${folderName}`)
          const email = src.get(emailId)!
          src.delete(emailId)
          trash.set(emailId, email)
          await saveState(c, loaded)
          await c.log('delete_email', { email_id: emailId, folder_name: folderName.toUpperCase() }, emailId, true)
          return { status: 'ok', email_id: emailId }
        })
      },
    },
    {
      name: 'search-emails',
      async run(c) {
        const query = need(c, 'query', "'--query'")
        const folderName = folderOption(c)
        return guarded(async () => {
          const loaded = await loadState(c)
          const folder = getFolder(loaded, folderName)
          const q = query.toLowerCase()
          let results: PyDict[] = []
          for (const email of folder.values()) {
            if (!isDict(email)) continue
            const sender = lower(get(email, 'sender', ''))
            const recipients = iterate(get(email, 'recipients', [])).map(lower)
            const subject = lower(get(email, 'subject', ''))
            const content = lower(get(email, 'content', ''))
            if (sender.includes(q) || recipients.some((r) => r.includes(q)) || subject.includes(q) || content.includes(q)) {
              results.push(email)
            }
          }
          results = sorted(results, (e) => num(get(e, 'timestamp', 0)), true)
          await c.log('search_emails', { query, folder_name: folderName.toUpperCase() }, results)
          return results
        })
      },
    },
    // Hidden ENV-tool commands (gaia2-eventd's, not the agent's).
    {
      name: 'create-and-add-email',
      async run(c) {
        const sender = need(c, 'sender', "'--sender'")
        const recipients = c.str('recipients')
        const subject = c.str('subject', '')!
        const content = c.str('content', '')!
        const folderName = folderOption(c)
        const parsedRecipients = truthy(recipients) ? parseJsonList(recipients) : []
        return guarded(async () => {
          const loaded = await loadState(c)
          const emailId = c.uuidHex()
          const emailObj: PyDict = {
            sender,
            recipients: parsedRecipients,
            subject,
            content,
            email_id: emailId,
            parent_id: null,
            cc: [],
            attachments: {},
            timestamp: c.now(),
            is_read: false,
          }
          getFolder(loaded, folderName).set(emailId, emailObj)
          await saveState(c, loaded)
          const args = { sender, recipients: parsedRecipients, subject, content, folder_name: folderName.toUpperCase() }
          await c.log('create_and_add_email', args, emailId, true)
          return { status: 'ok', email_id: emailId }
        })
      },
    },
    {
      name: 'send-email-to-user-only',
      async run(c) {
        const sender = need(c, 'sender', "'--sender'")
        const subject = c.str('subject', '')!
        const content = c.str('content', '')!
        return guarded(async () => {
          const loaded = await loadState(c)
          const userEmail = get(loaded.state, 'user_email', DEFAULT_USER_EMAIL)
          const emailId = c.uuidHex()
          const emailObj: PyDict = {
            sender,
            recipients: [userEmail],
            subject,
            content,
            email_id: emailId,
            parent_id: null,
            cc: [],
            attachments: {},
            timestamp: c.now(),
            is_read: false,
          }
          getFolder(loaded, 'INBOX').set(emailId, emailObj)
          await saveState(c, loaded)
          await c.log('send_email_to_user_only', { sender, subject, content }, emailId, true)
          return { status: 'ok', email_id: emailId }
        })
      },
    },
    {
      name: 'reply-to-email-from-user',
      async run(c) {
        const sender = need(c, 'sender', "'--sender'")
        const emailId = need(c, 'email_id', "'--email-id'")
        const content = c.str('content', '')!
        const attachmentPaths = c.str('attachment_paths')
        const parsedAttachments = parseJsonList(attachmentPaths)
        return guarded(async () => {
          const loaded = await loadState(c)
          const userEmail = get(loaded.state, 'user_email', DEFAULT_USER_EMAIL)
          const sent = getFolder(loaded, 'SENT')
          if (!sent.has(emailId)) throw valueError(`Email with id ${emailId} does not exist in SENT`)
          const original = sent.get(emailId)!
          const attachments = readAttachments(c, parsedAttachments)
          const newId = c.uuidHex()
          const reply: PyDict = {
            sender,
            recipients: [userEmail],
            subject: concat('Re: ', get(original, 'subject', '')),
            content,
            email_id: newId,
            parent_id: emailId,
            cc: [],
            attachments,
            timestamp: c.now(),
            is_read: false,
          }
          getFolder(loaded, 'INBOX').set(newId, reply)
          await saveState(c, loaded)
          const args = { sender, email_id: emailId, content, attachment_paths: parsedAttachments }
          await c.log('reply_to_email_from_user', args, newId, true)
          return { status: 'ok', email_id: newId }
        })
      },
    },
  ]
}
