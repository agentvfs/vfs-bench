// Each process owns one SQLite database, task clock and pair of loopback ports.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { startMailArms } from './arms.mjs'

const { run, timestamp, accounts } = JSON.parse(readFileSync('seed.json', 'utf8'))
const db = new DatabaseSync('mail.sqlite')
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
const insert = db.prepare('INSERT INTO MailMailbox(tenant, name, seq) VALUES (?, ?, ?)')
for (const account of accounts) {
  for (const [idx, folder] of ['INBOX', 'Sent', 'Drafts', 'Trash', 'Junk'].entries()) {
    insert.run(account, folder, idx)
  }
}
const empty = new DatabaseSync(':memory:')
empty.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
const runtime = {
  pool: { sql: id => id === run ? db : empty },
  state: () => ({ of: () => ({ clock: { nowMs: () => timestamp } }) }),
}
const arms = await startMailArms(runtime, 0, 0)
console.log(JSON.stringify(Object.fromEntries(arms.announces.map(a => [a.token, a.url]))))
async function stop() {
  await arms.close()
  db.close()
  empty.close()
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
