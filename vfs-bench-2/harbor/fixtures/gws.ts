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
 */
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const LABELS = ['INBOX', 'SENT', 'UNREAD', 'TRASH'].map((id) => ({ id, name: id, type: 'system' }))

/** gws's own id format (`st.nextId('msg')`): the kind, then four digits. */
const messageId = (n: number) => `msg${String(n).padStart(4, '0')}`

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
  return { labels: LABELS, messages, counters: [{ kind: 'msg', n: messages.length }] }
}
