/**
 * Mirage's gws fake's fixture for an email task: upstream's email seed
 * (mocks/email/src/seed.ts, `seedDatabase` for the task's `TASK_NAME`) as
 * Gmail messages.
 *
 * Upstream's mailbox is one table, `emails`, with a folder each. Here each
 * email is a gws `Message`: its sender and recipient become `From` and
 * `To`, its subject `Subject`, its time `Date` and `internalDate`, its body
 * `bodyText`. The inbox is the INBOX label, with UNREAD where upstream's
 * `is_read` is 0, and sent mail is SENT. The four system labels are Mirage's
 * own (integ/fixtures/gws/v1.json), and the `msg` counter starts past the
 * seeded ids, so a sent message takes the next one.
 *
 * A task whose image also runs the calendar mock (its `binaries` in
 * task-binary-map.json) gets Peter's calendar too: upstream's calendar seed
 * (mocks/calendar/src/seed.ts) for the task, as gws Calendar rows. Peter's
 * calendar is the primary one, under the id the fake's `primary` names, in
 * UTC, as upstream's mock keeps every time. Each of his `calendar_event`
 * rows is an `Event`: its title the summary, its description the
 * description, its start and end `startDateTime` and `endDateTime`, in UTC.
 * Its `event_type` and `source` have no field in an Event and are left out;
 * its `source_ref`, the note upstream's calendar page shows beside it, is
 * the description of an event that has none. Upstream's second user, Lois,
 * has no calendar here, and the `event` counter starts past the seeded ids
 * too.
 *
 * A task with a legacy startup script gets the rows it adds to the email
 * and calendar mocks too (`startup.ts`), after their seeds, as upstream's
 * image adds them once its mocks are up.
 */
import { Database } from 'bun:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { startupSql } from './startup.ts'

interface Email {
  id: number
  folder: string
  is_read: number
  recipient_email: string
  subject: string
  body: string
  created_at: string
  sender_username: string
  sender_email: string
}

interface CalendarEvent {
  id: number
  title: string
  description: string | null
  event_type: string
  start_time: string
  end_time: string
  source: string | null
  source_ref: string | null
}

const LABELS = ['INBOX', 'SENT', 'UNREAD', 'TRASH'].map((id) => ({ id, name: id, type: 'system' }))

/** The primary calendar's id, which `primary` names (integ/server/gws/store/state.ts). */
const PRIMARY_CALENDAR = 'integ@example.com'
/** Upstream's calendar user, Peter, whose events are the task's (mocks/calendar/src/seed.ts). */
const CALENDAR_USER = 'peter.griffin@work.mosi.inc'

/** gws's own id format (`st.nextId('msg')`): the kind, then four digits. */
const messageId = (n: number) => `msg${String(n).padStart(4, '0')}`

/** gws's event id format (`st.nextEventId()`): `evt`, then 23 digits. */
const eventId = (n: number) => `evt${String(n).padStart(23, '0')}`

/**
 * An upstream event time as RFC 3339 in UTC. The API stores
 * `toISOString()`; a seed writes `YYYY-MM-DD HH:MM:SS`, which the mock
 * reads as UTC too.
 */
const utc = (time: string) => {
  const zoned = /(Z|[+-]\d\d:\d\d)$/i.test(time) ? time : `${time.replace(' ', 'T')}Z`
  return new Date(zoned).toISOString().replace('.000Z', 'Z')
}

/** A mailbox, as an RFC 5322 address with its display name. */
const mailbox = (name: string, address: string) => `"${name.replace(/["\\]/g, '\\$&')}" <${address}>`

export async function gws(mock: string, task: string): Promise<Record<string, unknown[]>> {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-email-seed-'))
  const file = join(dir, 'email.db')
  const { initSchema } = (await import(join(mock, 'src', 'db.ts'))) as { initSchema: (db: Database) => void }
  const { seedDatabase } = (await import(join(mock, 'src', 'seed.ts'))) as { seedDatabase: (db: Database) => void }
  const db = new Database(file, { create: true })
  initSchema(db)
  seedDatabase(db)
  for (const sql of startupSql(dirname(dirname(mock)), task, 'email')) db.run(sql)
  const attachments = db.query('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }
  if (attachments.n > 0) throw new Error(`${task}: upstream seeds attachments, which this converter does not carry`)
  const me = db.query("SELECT username, email FROM users WHERE username = 'peter'").get() as { username: string; email: string }
  const emails = db
    .query(
      `SELECT e.id, e.folder, e.is_read, e.recipient_email, e.subject, e.body, e.created_at,
              s.username AS sender_username, s.email AS sender_email
       FROM emails e JOIN users s ON s.id = e.sender_id ORDER BY e.id`,
    )
    .all() as Email[]
  db.close()
  rmSync(dir, { recursive: true, force: true })

  const messages = emails.map((email, i) => {
    if (email.folder !== 'inbox' && email.folder !== 'sent') {
      throw new Error(`${task}: email ${email.id} is in ${email.folder}, which has no label here`)
    }
    // Upstream's `formatDateTime`: UTC, to the second.
    const at = Date.parse(`${email.created_at.replace(' ', 'T')}Z`)
    const id = messageId(i + 1)
    const from = email.folder === 'sent' ? mailbox(me.username, me.email) : mailbox(email.sender_username, email.sender_email)
    const labels = email.folder === 'sent' ? ['SENT'] : email.is_read === 0 ? ['INBOX', 'UNREAD'] : ['INBOX']
    return {
      id,
      threadId: id,
      internalDate: at,
      bodyText: email.body,
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: email.recipient_email },
        { name: 'Subject', value: email.subject },
        { name: 'Date', value: new Date(at).toUTCString().replace('GMT', '+0000') },
      ],
      labels: labels.map((labelId) => ({ labelId })),
    }
  })
  const counters = [{ kind: 'msg', n: messages.length }]
  if (!binaries(mock, task).includes('calendar')) return { labels: LABELS, messages, counters }
  const events = await calendarEvents(join(dirname(mock), 'calendar'), task)
  const calendars = [
    { id: PRIMARY_CALENDAR, summary: CALENDAR_USER, timeZone: 'UTC', accessRole: 'owner', primary: true, events },
  ]
  return { labels: LABELS, messages, calendars, counters: [...counters, { kind: 'event', n: events.length }] }
}

/** The mocks upstream's image for the task runs (config/task-binary-map.json). */
function binaries(mock: string, task: string): string[] {
  const map = JSON.parse(readFileSync(join(dirname(mock), '..', 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, { binaries: string[] }>
  }
  return map.tasks[task]?.binaries ?? []
}

/** Peter's calendar events in upstream's calendar seed for the task, as gws Events. */
async function calendarEvents(mock: string, task: string): Promise<Record<string, unknown>[]> {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-calendar-seed-'))
  const { initSchema } = (await import(join(mock, 'src', 'db', 'schema.ts'))) as { initSchema: (db: Database) => void }
  const { seedDatabase } = (await import(join(mock, 'src', 'seed.ts'))) as { seedDatabase: (db: Database) => void }
  const db = new Database(join(dir, 'calendar.db'), { create: true })
  // The seed logs to stdout, which is the fixture's.
  const log = console.log
  console.log = (...args: unknown[]) => console.error(...args)
  try {
    initSchema(db)
    seedDatabase(db)
    for (const sql of startupSql(dirname(dirname(mock)), task, 'calendar')) db.run(sql)
  } finally {
    console.log = log
  }
  const rows = db
    .query(
      `SELECT e.id, e.title, e.description, e.event_type, e.start_time, e.end_time, e.source, e.source_ref
       FROM calendar_event e JOIN users u ON u.id = e.user_id WHERE u.email = ? ORDER BY e.id`,
    )
    .all(CALENDAR_USER) as CalendarEvent[]
  db.close()
  rmSync(dir, { recursive: true, force: true })
  // Seeded now, as the fake stamps an event it creates.
  const now = new Date().toISOString()
  return rows.map((event, i) => {
    // An event's source_ref is a note the calendar shows with it; with no
    // description beside it, it is the Event's description. Its source, a
    // category, has no field and is left out.
    if (event.source_ref !== null && event.description !== null) {
      throw new Error(`${task}: calendar event ${event.id} has a description and a source_ref, which an Event cannot both carry`)
    }
    const description = event.description ?? event.source_ref
    return {
      id: eventId(i + 1),
      summary: event.title,
      ...(description === null ? {} : { description }),
      startDateTime: utc(event.start_time),
      endDateTime: utc(event.end_time),
      created: now,
      updated: now,
    }
  })
}
