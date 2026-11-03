/**
 * The Gmail, Drive, Sheets and Slack APIs that Mirage's own mounts read
 * (`/gmail`, `/drive`, `/sheets`, `/slack`; submodule/mirage at 03695b9a),
 * answered from the run's world, the tables upstream's tools read. Each
 * request that stands for an upstream read tool is recorded as that tool,
 * with its arguments as upstream takes them, and its witness (the text the
 * read served that the agent's output must show, graders/seen.ts):
 *
 *     GET messages/<id>              gmail.messages.get {id}, a draft's gmail.drafts.get {id}
 *     GET files/<id>?alt=media       google_drive.files.download {fileId}
 *     GET files?q='root' in parents  google_drive.files.list {}
 *     GET files?q=fullText ...       google_drive.files.list {q} (gdrive's grep -w)
 *     GET spreadsheets/<id>          google_sheets.spreadsheets.values.get, one per range
 *     GET conversations.history      slack.conversations_history {channel}, a day's
 *
 * The rest (labels, listings of messages, file metadata, the sheet's file
 * listing, channels, the channel's probe for its latest day) records
 * nothing. Answers are the vendors' wire shapes as Mirage's integ fakes
 * write them (`fmtGmailMessage`, `messageJson`, `channelJson`), and the same
 * bytes each time, since Gmail and Slack sizes come from the listing.
 */
import { createHash } from 'node:crypto'

import { type Ctx, type KitRoute, type Reply, rangeReply, route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { fmtGmailMessage } from '../../../../submodule/mirage/integ/server/gws/gmail/message.ts'
import { channelJson, messageJson } from '../../../../submodule/mirage/integ/server/slack/wire.ts'
import { loads } from '../../../enterpriseops/mocks/enterpriseops/py.ts'
import { Conn } from '../../../enterpriseops/mocks/enterpriseops/sqlite.ts'
import type { Witness } from '../../graders/seen.ts'
import type { ErpClient } from './config.ts'
import { type Dict, deepcopy } from './py.ts'
import { kitOfRun, record, remember } from './run.ts'
import { AS_OF, type Kit, World } from './world.ts'

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

interface Run {
  conn: Conn
  kit: Kit
  code: string
}

/** A request's work on its run's file, committed at the end. */
function onRun(ctx: Ctx<ErpClient>, work: (run: Run) => Reply): Reply {
  const conn = new Conn(ctx.db.file, () => ctx.clock.nowMs())
  try {
    const kit = kitOfRun(conn)
    const reply = work({ conn, kit, code: kit.task.tenant_code as string })
    conn.commit()
    return reply
  } finally {
    conn.close()
  }
}

const json = (status: number, value: unknown): Reply => ({
  status,
  body: Buffer.from(JSON.stringify(value)),
  headers: { 'Content-Type': 'application/json' },
})
const googleNotFound = (what: string) => json(404, { error: { code: 404, message: `${what} not found`, status: 'NOT_FOUND' } })

/** Upstream's read tool's answer, recorded under its name, with the read's witness. */
function recorded(run: Run, tool: string, args: Dict, witness: Witness, result?: Dict): void {
  const answer = result ?? new World(run.kit, run.conn).dispatch(tool, deepcopy(args))
  remember(run.conn, record(run.conn, tool, args, true, answer), witness)
}

const rows = (run: Run, sql: string, params: unknown[] = []) => run.conn.execute(sql, [run.code, ...params]).fetchall() as Dict[]
const witnessOf = (run: Run, id: string): Witness | undefined => (run.kit.witnesses ?? {})[id]

// ---- Gmail ----

interface Mail {
  id: string
  label: 'INBOX' | 'DRAFT'
  from: string
  to: string
  subject: string
  ms: number
  body: string
}

function mails(run: Run): Mail[] {
  const inbox = rows(run, 'SELECT message_id, sender, recipients_json, subject, sent_at, body FROM mail_messages WHERE tenant_code = ?').map(
    (r): Mail => ({
      id: r.message_id as string,
      label: 'INBOX',
      from: r.sender as string,
      to: (JSON.parse(r.recipients_json as string) as string[]).join(', '),
      subject: r.subject as string,
      ms: Date.parse(r.sent_at as string),
      body: r.body as string,
    })
  )
  const drafts = rows(run, 'SELECT draft_id, recipient, subject, body FROM mail_drafts WHERE tenant_code = ?').map(
    (r): Mail => ({
      id: r.draft_id as string,
      label: 'DRAFT',
      from: 'analyst',
      to: r.recipient as string,
      subject: r.subject as string,
      ms: Date.parse(AS_OF),
      body: r.body as string,
    })
  )
  return [...inbox, ...drafts]
}

/** A message body's start as Mirage's `.gmail.json` prints it (convert.py's `rendered`). */
const rendered = (body: string) => `"body_text":"${JSON.stringify(body.slice(0, 40)).slice(1, -1)}`

const gmailRoutes = (): KitRoute<ErpClient>[] => [
  route<ErpClient>('GET', '/gmail/v1/users/me/labels', () =>
    json(200, {
      labels: [
        { id: 'INBOX', name: 'INBOX', type: 'system' },
        { id: 'DRAFT', name: 'DRAFT', type: 'system' },
      ],
    })
  ),
  route<ErpClient>(
    'GET',
    '/gmail/v1/users/me/messages',
    (ctx) =>
      onRun(ctx, (run) => {
        const label = ctx.query.get('labelIds') ?? 'INBOX'
        const q = ctx.query.get('q') ?? ''
        const after = /after:(\d+)/.exec(q)
        const before = /before:(\d+)/.exec(q)
        const found = mails(run)
          .filter((m) => m.label === label)
          .filter((m) => (after === null || m.ms / 1000 > Number(after[1])) && (before === null || m.ms / 1000 < Number(before[1])))
          .sort((a, b) => b.ms - a.ms || (a.id < b.id ? -1 : 1))
          .slice(0, Number(ctx.query.get('maxResults') ?? 100))
        return json(200, { messages: found.map((m) => ({ id: m.id, threadId: m.id })), resultSizeEstimate: found.length })
      }),
    { write: true }
  ),
  route<ErpClient>(
    'GET',
    '/gmail/v1/users/me/messages/:id',
    (ctx) =>
      onRun(ctx, (run) => {
        const mail = mails(run).find((m) => m.id === ctx.params.id)
        if (mail === undefined) return googleNotFound(`message ${ctx.params.id}`)
        // A draft's body is the agent's own text, which its command shows: only the rendered file proves the read.
        const witness = (mail.label === 'INBOX' && witnessOf(run, mail.id)) || { all: [rendered(mail.body)] }
        recorded(run, mail.label === 'DRAFT' ? 'gmail.drafts.get' : 'gmail.messages.get', { id: mail.id }, witness)
        return json(
          200,
          fmtGmailMessage({
            id: mail.id,
            threadId: mail.id,
            labelIds: [mail.label],
            internalDate: mail.ms,
            headers: [
              { name: 'From', value: mail.from },
              { name: 'To', value: mail.to },
              { name: 'Subject', value: mail.subject },
              { name: 'Date', value: new Date(mail.ms).toUTCString() },
            ],
            bodyText: mail.body,
            attachments: [],
          })
        )
      }),
    { write: true }
  ),
]

// ---- Drive and Sheets' files ----

function driveFile(r: Dict): Dict {
  const content = r.content as string
  return {
    id: r.file_id,
    name: r.name,
    mimeType: r.mime_type,
    size: String(Buffer.byteLength(content, 'utf8')),
    md5Checksum: createHash('md5').update(content, 'utf8').digest('hex'),
    createdTime: r.modified_time,
    modifiedTime: r.modified_time,
    parents: ['root'],
    owners: [{ me: true }],
    capabilities: { canEdit: false },
  }
}

/** A spreadsheet as Drive lists it: gsheets files it under `owned/` and checks its name on every read. */
const sheetFile = (r: Dict): Dict => ({ id: r.spreadsheet_id, name: r.title, mimeType: SHEET_MIME, modifiedTime: AS_OF, owners: [{ me: true }] })

/** A Drive query's `<field> contains '...'` literal, unescaped. */
function literal(q: string, field: string): string | null {
  const m = new RegExp(`${field} contains '((?:[^'\\\\]|\\\\.)*)'`).exec(q)
  return m === null ? null : m[1]!.replace(/\\(.)/g, '$1')
}

/** A file as upstream's `files.list` lists it. */
const listed = (r: Dict) => ({
  id: r.file_id,
  name: r.name,
  mimeType: r.mime_type,
  version: r.version,
  isCurrentAuthority: Boolean(r.is_current),
  modifiedTime: r.modified_time,
})

const codepoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const driveRoutes = (): KitRoute<ErpClient>[] => [
  route<ErpClient>('GET', '/drive/v3/drives', () => json(200, { drives: [] })),
  route<ErpClient>(
    'GET',
    '/drive/v3/files',
    (ctx) =>
      onRun(ctx, (run) => {
        const q = ctx.query.get('q') ?? ''
        const text = literal(q, 'fullText')
        // A spreadsheet-typed query is the Sheets mount's, never a Drive read.
        if (q.includes(`mimeType='${SHEET_MIME}'`)) {
          const sheets = rows(run, 'SELECT spreadsheet_id, title, ranges_json FROM spreadsheets WHERE tenant_code = ? ORDER BY spreadsheet_id')
          const needle = text?.toLowerCase()
          const found = needle === undefined ? sheets : sheets.filter((r) => `${r.title}\n${r.ranges_json}`.toLowerCase().includes(needle))
          return json(200, { files: found.map(sheetFile), incompleteSearch: false })
        }
        const files = rows(run, 'SELECT * FROM drive_files WHERE tenant_code = ? ORDER BY name')
        // gdrive's search names the root's parents too, so it is matched first.
        if (text !== null) {
          const needle = text.toLowerCase()
          const found = files.filter((r) => `${r.name}\n${r.content}`.toLowerCase().includes(needle))
          const witness = found.length ? { any: found.map((r) => r.name as string) } : {}
          recorded(run, 'google_drive.files.list', { q }, witness, { files: found.map(listed) })
          return json(200, { files: found.map(driveFile), incompleteSearch: false })
        }
        if (q.includes(' in parents')) {
          const names = files.map((r) => r.name as string).sort(codepoints)
          recorded(run, 'google_drive.files.list', {}, { all: names.slice(0, 3) }, { files: files.map(listed) })
          return json(200, { files: files.map(driveFile) })
        }
        return json(200, { files: [] })
      }),
    { write: true }
  ),
  route<ErpClient>(
    'GET',
    '/drive/v3/files/:id',
    (ctx) =>
      onRun(ctx, (run) => {
        const id = ctx.params.id!
        const file = rows(run, 'SELECT * FROM drive_files WHERE tenant_code = ? AND file_id = ?', [id])[0]
        if (ctx.query.get('alt') === 'media') {
          if (file === undefined) return googleNotFound(`file ${id}`)
          recorded(run, 'google_drive.files.download', { fileId: id }, witnessOf(run, id) ?? {})
          return rangeReply(ctx.headers, Buffer.from(file.content as string, 'utf8'), file.mime_type as string)
        }
        if (file !== undefined) return json(200, driveFile(file))
        const sheet = rows(run, 'SELECT spreadsheet_id, title FROM spreadsheets WHERE tenant_code = ? AND spreadsheet_id = ?', [id])[0]
        return sheet === undefined ? googleNotFound(`file ${id}`) : json(200, sheetFile(sheet))
      }),
    { write: true }
  ),
]

// ---- Sheets ----

const column = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

/** A range key's tab and top-left cell: no row for a bare tab, whole columns or a key that does not parse. */
function anchor(key: string): { tab: string; row: number | null; col: number } {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))(?:!([A-Z]+)(\d+)?(?::[A-Z]+\d*)?)?$/.exec(key)
  if (m === null) return { tab: key, row: null, col: 0 }
  const tab = m[1] !== undefined ? m[1].replaceAll("''", "'") : m[2]!
  return { tab, row: m[4] === undefined ? null : Number(m[4]) - 1, col: m[3] === undefined ? 0 : column(m[3]) }
}

/** A cell's value: a `PyFloat` as its number. */
const scalar = (v: unknown): unknown => (v !== null && typeof v === 'object' && 'v' in v ? (v as { v: unknown }).v : v)

function cell(raw: unknown): Dict {
  const v = scalar(raw)
  if (v === null || v === undefined || v === '') return {}
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v }, effectiveValue: { boolValue: v }, formattedValue: v ? 'TRUE' : 'FALSE' }
  if (typeof v === 'number' || typeof v === 'bigint') {
    const n = Number(v)
    return { userEnteredValue: { numberValue: n }, effectiveValue: { numberValue: n }, formattedValue: String(n) }
  }
  const s = String(v)
  return { userEnteredValue: { stringValue: s }, effectiveValue: { stringValue: s }, formattedValue: s }
}

/** Every range key on its tab's grid at its A1 cell, in sorted order; a key without a row goes below the tab's rows. */
function grid(ranges: Dict): Map<string, unknown[][]> {
  const tabs = new Map<string, unknown[][]>()
  for (const key of Object.keys(ranges).sort()) {
    const values = ranges[key]
    if (!Array.isArray(values)) continue
    const { tab, row, col } = anchor(key)
    const cells = tabs.get(tab) ?? []
    tabs.set(tab, cells)
    const top = row ?? cells.length
    values.forEach((line, i) => {
      if (!Array.isArray(line)) return
      const target = (cells[top + i] ??= [])
      line.forEach((v, j) => (target[col + j] = v))
    })
  }
  return tabs
}

/** A range's witness: the string cells of its first two rows, or their numbers where it has none. */
function rangeWitness(values: unknown): Witness {
  const cells = (Array.isArray(values) ? values.slice(0, 2) : []).flatMap((line) => (Array.isArray(line) ? line.map(scalar) : []))
  const strings = cells.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return { all: strings.length ? strings : cells.filter((v) => v !== null && v !== undefined && v !== '').map((v) => String(Number(v))) }
}

const sheetRoutes = (): KitRoute<ErpClient>[] => [
  route<ErpClient>(
    'GET',
    '/v4/spreadsheets/:id',
    (ctx) =>
      onRun(ctx, (run) => {
        const id = ctx.params.id!
        const sheet = rows(run, 'SELECT spreadsheet_id, title, ranges_json FROM spreadsheets WHERE tenant_code = ? AND spreadsheet_id = ?', [id])[0]
        if (sheet === undefined) return googleNotFound(`spreadsheet ${id}`)
        const ranges = loads<Dict>(sheet.ranges_json as string)
        for (const key of Object.keys(ranges).sort())
          recorded(run, 'google_sheets.spreadsheets.values.get', { spreadsheetId: id, range: key }, rangeWitness(ranges[key]))
        const sheets = [...grid(ranges)].map(([title, cells], index) => ({
          properties: { sheetId: index, title, index },
          data: [{ rowData: Array.from(cells, (line) => ({ values: Array.from(line ?? [], cell) })) }],
        }))
        return json(200, { spreadsheetId: id, properties: { title: sheet.title }, sheets })
      }),
    { write: true }
  ),
]

// ---- Slack ----

interface Message {
  ts: string
  user: string
  text: string
}

const channelName = (channel: string) => channel.replace(/^#/, '')
const channelId = (name: string) => `C${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`

/** Each channel's messages and the task's posts, ascending, `ts` the epoch second with a microsecond tie-break. */
function channels(run: Run): Map<string, Message[]> {
  const seeded = rows(run, 'SELECT channel, author, text, posted_at FROM chat_messages WHERE tenant_code = ? ORDER BY posted_at, message_id').map((r) => ({
    channel: channelName(r.channel as string),
    user: r.author as string,
    text: r.text as string,
    at: Date.parse(r.posted_at as string),
  }))
  const posts = rows(run, 'SELECT channel, text FROM chat_posts WHERE tenant_code = ? ORDER BY post_id').map((r) => ({
    channel: channelName(r.channel as string),
    user: 'analyst',
    text: r.text as string,
    at: Date.parse(AS_OF),
  }))
  const out = new Map<string, Message[]>()
  for (const m of [...seeded, ...posts]) {
    const list = out.get(m.channel) ?? []
    out.set(m.channel, list)
    const second = Math.floor(m.at / 1000)
    const tie = list.filter((x) => x.ts.startsWith(`${second}.`)).length
    list.push({ ts: `${second}.${String(tie).padStart(6, '0')}`, user: m.user, text: m.text })
  }
  return out
}

const line = (m: Message) => messageJson({ type: 'message', userId: m.user, text: m.text, ts: m.ts, threadTs: null, reactionsJson: null }, [], '')
const slack = (value: Dict): Reply => json(200, { ok: true, ...value })
const empty = { response_metadata: { next_cursor: '' } }

const slackRoutes = (): KitRoute<ErpClient>[] => [
  route<ErpClient>(
    'GET',
    '/slack/api/:method',
    (ctx) =>
      onRun(ctx, (run) => {
        const method = ctx.params.method
        const all = channels(run)
        if (method === 'conversations.list') {
          if (!(ctx.query.get('types') ?? '').split(',').includes('public_channel')) return slack({ channels: [], ...empty })
          const list = [...all].map(([name, messages]) =>
            channelJson({
              id: channelId(name),
              name,
              kind: 'public',
              created: Math.floor(Number(messages[0]!.ts)),
              isArchived: false,
              isPrivate: false,
              dmUserId: null,
              topic: '',
              purpose: '',
              membersJson: '[]',
              isMember: true,
            })
          )
          return slack({ channels: list, ...empty })
        }
        if (method === 'users.list') return slack({ members: [], ...empty })
        if (method === 'conversations.history') {
          const name = [...all.keys()].find((n) => channelId(n) === ctx.query.get('channel'))
          if (name === undefined) return json(200, { ok: false, error: 'channel_not_found' })
          const messages = all.get(name)!
          const oldest = ctx.query.get('oldest')
          // Without `oldest`, the listing's probe for the channel's latest day.
          if (oldest === null) return slack({ messages: messages.slice(-1).map(line), has_more: false })
          const latest = Number(ctx.query.get('latest') ?? Infinity)
          const day = messages.filter((m) => Number(m.ts) >= Number(oldest) && Number(m.ts) <= latest)
          if (day.length) {
            const witness = { any: day.map((m) => JSON.stringify(line(m)).slice(0, 60)) }
            const result = { ok: true, channel: `#${name}`, messages: day.map((m) => ({ ts: m.ts, user: m.user, text: m.text })) }
            recorded(run, 'slack.conversations_history', { channel: `#${name}` }, witness, result)
          }
          return slack({ messages: day.map(line), has_more: false, ...empty })
        }
        return json(200, { ok: false, error: 'unknown_method' })
      }),
    { write: true }
  ),
]

/** The REST routes Mirage's mounts reach, beside `POST /<tool>`. */
export const restRoutes = (): KitRoute<ErpClient>[] => [...gmailRoutes(), ...driveRoutes(), ...sheetRoutes(), ...slackRoutes()]
