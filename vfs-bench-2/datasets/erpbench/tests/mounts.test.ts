/**
 * The erpbench fake under Mirage's own Gmail, Drive, Sheets and Slack mounts
 * (submodule/mirage at 03695b9a), built from the mount block convert.py
 * writes for erpbench-001: which requests the fake records as upstream's
 * read tools, with which arguments, and the witness each one is kept by
 * (graders/seen.ts). The fake runs as Harbor starts it (workspace/fakes.ts);
 * `_trace` and `_seen` are read through its token-gated state view. Needs
 * datasets/erpbench/download.py.
 */
import assert from 'node:assert/strict'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'

import { Workspace, configToWorkspaceArgs, loadWorkspaceConfig } from '@struktoai/mirage-node'
import { parse } from 'yaml'

import { type Seen, type Witness, flat, shows as seenShows } from '../graders/seen.ts'

const ROOT = new URL('../../../', import.meta.url).pathname
const TASK = 'erpbench-001'
const KIT = join(ROOT, 'state', 'erpbench', 'kit', `${TASK}.json`)
const WORKSPACE_YAML = join(ROOT, 'datasets', 'erpbench', TASK, 'workspace', 'workspace.yaml')
const AS_OF = '2026-02-09T09:00:00Z'
const TOKEN = randomBytes(16).toString('hex')
const skip = !existsSync(KIT) && 'run datasets/erpbench/download.py first'

type Entry = { index: number; tool: string; arguments: Record<string, unknown>; success: boolean }

let fake: { url: string; proc: ChildProcess; root: string }
let runs = 0

before(async () => {
  if (skip) return
  const root = mkdtempSync(join(tmpdir(), 'erpbench-mounts-'))
  mkdirSync(join(root, 'fixtures', 'erpbench'), { recursive: true })
  writeFileSync(join(root, 'fixtures', 'erpbench', 'default.json'), '{"seed": []}\n')
  const proc = spawn(
    process.execPath,
    ['workspace/fakes.ts', '--service', 'erpbench', '--root', root, '--fixture', 'default', '--log', join(root, 'fake.log')],
    { cwd: ROOT, env: { ...process.env, VFSBENCH_STATE_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] }
  )
  for await (const line of createInterface({ input: proc.stdout! })) {
    if (line.startsWith('FAKE=')) {
      fake = { url: JSON.parse(line.slice(5)).url, proc, root }
      return
    }
  }
  throw new Error(`the fake did not start (see ${root})`)
})

after(() => {
  if (!fake) return
  fake.proc.stdin!.end()
  fake.proc.kill()
  rmSync(fake.root, { recursive: true, force: true })
})

/** A fresh run of the task's world and a workspace with the task's four mounts on it. */
async function open(): Promise<Run> {
  const run = `m${++runs}`
  const fixture = `t-${TASK}`
  writeFileSync(join(fake.root, 'fixtures', 'erpbench', `${fixture}.json`), JSON.stringify({ seed: [{ id: 1, task: TASK }] }))
  const reset = await fetch(`${fake.url}/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run, fixture, epoch: AS_OF }),
  })
  assert.equal(reset.status, 200, await reset.text())
  const block = parse(readFileSync(WORKSPACE_YAML, 'utf8')).workspace
  const config = JSON.parse(JSON.stringify({ mounts: block.mounts, cache: block.cache }).replaceAll('${ERPBENCH_URL}', `${fake.url}/_run/${run}`))
  const args = await configToWorkspaceArgs(loadWorkspaceConfig(config))
  return new Run(run, new Workspace(args.mounts, args.options), Object.keys(block.mounts ?? {}))
}

class Run {
  readonly run: string
  readonly ws: Workspace
  readonly mounts: string[]

  constructor(run: string, ws: Workspace, mounts: string[]) {
    this.run = run
    this.ws = ws
    this.mounts = mounts
  }

  async view(): Promise<{ trace: Entry[]; seen: Seen[] }> {
    const reply = await fetch(`${fake.url}/_run/${this.run}/_verifier/state?query=trace&query=seen`, {
      headers: { 'x-vfsbench-state-token': TOKEN },
    })
    const body = (await reply.json()) as Record<string, { json: string }[]>
    return { trace: JSON.parse(body['query-0']![0]!.json), seen: JSON.parse(body['query-1']![0]!.json) }
  }

  /** A line's output and what it added to `_trace` and `_seen`. */
  async line(cmd: string) {
    const before = await this.view()
    const started = Date.now()
    const io = await this.ws.shell(cmd)
    const ended = Date.now()
    const now = await this.view()
    const entries = now.trace.slice(before.trace.length)
    const seen = new Map(now.seen.map((s) => [s.idx, s]))
    return { stdout: io.stdoutText, stderr: io.stderrText, exit: io.exitCode, entries, seen, started, ended }
  }

  async post(tool: string, body: object) {
    const reply = await fetch(`${fake.url}/_run/${this.run}/${tool}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal(reply.status, 200, await reply.text())
  }

  close = () => this.ws.close()
}

type Line = Awaited<ReturnType<Run['line']>>
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x))
const has = (entries: Entry[], tool: string, args: object) =>
  entries.some((e) => e.tool === tool && e.success && canonical(e.arguments) === canonical(args))
const of = (entries: Entry[], tool: string) => entries.filter((e) => e.tool === tool)
const shows = (out: string, w: Witness) => seenShows(flat(out), w)
const witnessOf = (r: Line, e: Entry) => r.seen.get(e.index)!.witness
/** The sheet's seeded range keys, from the kit's SQL. */
function seededKeys(): string[] {
  const sql = JSON.parse(readFileSync(KIT, 'utf8')).sql as string
  const m = /INSERT INTO "spreadsheets" VALUES\('SHEET-NBR-OPS','[^']*','[^']*','((?:[^']|'')*)'\)/.exec(sql)
  return Object.keys(JSON.parse(m![1]!.replaceAll("''", "'"))).sort()
}

test('each mount read is recorded as upstream read tool, its witness in what the read printed', { skip }, async () => {
  const r = await open()
  try {
    assert.deepEqual([...r.mounts].sort(), ['/drive', '/gmail', '/sheets', '/slack'])
    const mail = await r.line(`cat /gmail/INBOX/*/*__MSG-${TASK}-REQUEST.gmail.json`)
    assert.equal(mail.exit, 0, mail.stderr)
    assert.ok(has(mail.entries, 'gmail.messages.get', { id: `MSG-${TASK}-REQUEST` }))
    const read = mail.entries.findLast((e) => e.tool === 'gmail.messages.get')!
    assert.equal(canonical(read.arguments), canonical({ id: `MSG-${TASK}-REQUEST` }))
    assert.ok(shows(mail.stdout, witnessOf(mail, read)), 'the request mail witness is in the cat')
    // The host's clock, not the fake's frozen one.
    const at = mail.seen.get(read.index)!.at_ms
    assert.ok(at >= mail.started && at <= mail.ended, String(at))

    const file = await r.line('cat /drive/01-consolidated-order-batch.xlsx')
    assert.equal(file.exit, 0, file.stderr)
    assert.ok(has(file.entries, 'google_drive.files.download', { fileId: 'FILE-NBR-ORDER-BATCH-0209' }))
    assert.ok(shows(file.stdout, witnessOf(file, of(file.entries, 'google_drive.files.download')[0]!)))

    const sheet = await r.line('cat /sheets/owned/*__SHEET-NBR-OPS.gsheet.json')
    assert.equal(sheet.exit, 0, sheet.stderr)
    const ranges = of(sheet.entries, 'google_sheets.spreadsheets.values.get')
    assert.deepEqual([...new Set(ranges.map((e) => e.arguments.range))].sort(), seededKeys())
    assert.ok(ranges.every((e) => canonical(Object.keys(e.arguments).sort()) === canonical(['range', 'spreadsheetId'])))
    assert.ok(ranges.every((e) => e.arguments.spreadsheetId === 'SHEET-NBR-OPS'))
    const strings = await r.line(`jq -r '..|strings' /sheets/owned/*__SHEET-NBR-OPS.gsheet.json`)
    for (const e of ranges) {
      assert.ok(shows(sheet.stdout, witnessOf(sheet, e)), `${e.arguments.range} in the JSON`)
      assert.ok(shows(strings.stdout, witnessOf(sheet, e)), `${e.arguments.range} in jq -r`)
    }

    const day = await r.line('cat /slack/channels/ops-nbr__*/2026-02-09/chat.jsonl')
    assert.equal(day.exit, 0, day.stderr)
    assert.ok(has(day.entries, 'slack.conversations_history', { channel: '#ops-nbr' }))
    assert.ok(of(day.entries, 'slack.conversations_history').every((e) => shows(day.stdout, witnessOf(day, e))))

    const listing = await r.line('ls /drive')
    assert.ok(has(listing.entries, 'google_drive.files.list', {}))
    assert.ok(shows(listing.stdout, witnessOf(listing, of(listing.entries, 'google_drive.files.list')[0]!)))
  } finally {
    await r.close()
  }
})

test('a Drive search is recorded as its query and reads only what it matched', { skip }, async () => {
  const r = await open()
  try {
    const hit = await r.line('grep -rw CA-PO-77310 /drive')
    const search = hit.entries.filter((e) => e.tool === 'google_drive.files.list' && String(e.arguments.q ?? '').includes('fullText'))
    assert.equal(search.length, 1)
    assert.deepEqual(Object.keys(search[0]!.arguments), ['q'])
    assert.match(String(search[0]!.arguments.q), /fullText contains 'CA-PO-77310'/)
    assert.ok(shows(hit.stdout, witnessOf(hit, search[0]!)))
    const downloads = of(hit.entries, 'google_drive.files.download')
    assert.deepEqual([...new Set(downloads.map((e) => e.arguments.fileId))].sort(), [
      'FILE-NBR-OPS-AUDIT-LOG',
      'FILE-NBR-ORDER-BATCH-0203',
      'FILE-NBR-ORDER-BATCH-0209',
    ])
    for (const e of downloads) {
      // The audit log's distinctive line does not name the order, so grep never prints it.
      const want = e.arguments.fileId !== 'FILE-NBR-OPS-AUDIT-LOG'
      assert.equal(shows(hit.stdout, witnessOf(hit, e)), want, String(e.arguments.fileId))
    }
    const walk = hit.entries.filter((e) => e.tool === 'google_drive.files.list' && canonical(e.arguments) === '{}')
    assert.ok(walk.every((e) => !shows(hit.stdout, witnessOf(hit, e))))

    const miss = await r.line('grep -rw zzqnomatch /drive')
    const none = miss.entries.find((e) => e.tool === 'google_drive.files.list' && String(e.arguments.q ?? '').includes('zzqnomatch'))!
    assert.deepEqual(witnessOf(miss, none), {})
    // With no hit, gdrive's grep reads every file; it prints none of them, so none is seen.
    assert.deepEqual(miss.stdout, '')
    assert.ok(of(miss.entries, 'google_drive.files.download').every((e) => !shows(miss.stdout, witnessOf(miss, e))))
  } finally {
    await r.close()
  }
})

test('listings, the channel probe and an empty day record nothing', { skip }, async () => {
  const r = await open()
  try {
    const lines = ['ls /gmail', 'ls /sheets/owned', 'ls /slack/users', 'ls /slack/channels/ops-nbr__*/', 'cat /slack/channels/ops-nbr__*/2026-02-05/chat.jsonl']
    for (const cmd of lines) {
      const out = await r.line(cmd)
      assert.equal(out.exit, 0, `${cmd}: ${out.stderr}`)
      assert.deepEqual(out.entries, [], cmd)
    }
    const sheetSearch = await r.line('grep -rw price /sheets')
    assert.deepEqual(of(sheetSearch.entries, 'google_drive.files.list'), [])
  } finally {
    await r.close()
  }
})

test('a view that does not show content does not show the witness', { skip }, async () => {
  const r = await open()
  try {
    const label = await r.line('ls /gmail/INBOX/*')
    const fetched = of(label.entries, 'gmail.messages.get')
    assert.ok(fetched.length >= 1)
    assert.ok(fetched.every((e) => !shows(label.stdout, witnessOf(label, e))))
    const heads = await r.line('head -n 1 /drive/*')
    const downloads = of(heads.entries, 'google_drive.files.download')
    assert.ok(downloads.length >= 10)
    assert.deepEqual(downloads.filter((e) => shows(heads.stdout, witnessOf(heads, e))).map((e) => e.arguments.fileId), [])
    // The request mail's body is the task prompt, which `erpbench get-task` prints.
    const mail = await r.line(`cat /gmail/INBOX/*/*__MSG-${TASK}-REQUEST.gmail.json`)
    const prompt = JSON.parse(readFileSync(KIT, 'utf8')).task.prompt as string
    assert.equal(shows(prompt, witnessOf(mail, mail.entries.findLast((e) => e.tool === 'gmail.messages.get')!)), false)
  } finally {
    await r.close()
  }
})

test('a second read of the same file or listing still reaches the fake', { skip }, async () => {
  const r = await open()
  try {
    await r.line('grep -rw CA-PO-77310 /drive')
    const again = await r.line('cat /drive/01-consolidated-order-batch.xlsx')
    assert.ok(has(again.entries, 'google_drive.files.download', { fileId: 'FILE-NBR-ORDER-BATCH-0209' }))
    await r.line('ls /drive')
    const relist = await r.line('ls /drive')
    assert.ok(has(relist.entries, 'google_drive.files.list', {}))
  } finally {
    await r.close()
  }
})

test('a post and a draft read back through the mounts', { skip }, async () => {
  const r = await open()
  try {
    await r.line('cat /slack/channels/ops-nbr__*/2026-02-09/chat.jsonl')
    const text = `${TASK}: submitted, readback marker 4471`
    await r.post('slack.chat_postMessage', { task_id: TASK, channel: '#ops-nbr', text, review_status: 'draft_for_review' })
    const day = await r.line('cat /slack/channels/ops-nbr__*/2026-02-09/chat.jsonl')
    assert.ok(day.stdout.includes('readback marker 4471'), day.stderr)
    const history = of(day.entries, 'slack.conversations_history')
    // A message's witness is its rendered chat.jsonl line's start.
    assert.ok(history.some((e) => (witnessOf(day, e).any ?? []).some((f) => f.includes('"user":"analyst","text":"erpbench-001'))))
    const last = await r.line('tail -n 1 /slack/channels/ops-nbr__*/2026-02-09/chat.jsonl')
    assert.ok(of(last.entries, 'slack.conversations_history').some((e) => shows(last.stdout, witnessOf(last, e))))
    await r.post('slack.chat_postMessage', { task_id: TASK, channel: 'ops-nbr', text, review_status: 'draft_for_review' })
    const channels = await r.line('ls /slack/channels')
    assert.equal(channels.stdout.split(/\s+/).filter((n) => n.startsWith('ops-nbr__')).length, 1, channels.stdout)

    await r.post('gmail.drafts.create', {
      task_id: TASK,
      to: 'dana.whitfield@northbridge-sim.example',
      subject: 'Re: request',
      body: 'Draft body for review 4471',
    })
    const draft = await r.line(`cat /gmail/DRAFT/*/*__DRAFT-${TASK}.gmail.json`)
    assert.equal(draft.exit, 0, draft.stderr)
    assert.ok(has(draft.entries, 'gmail.drafts.get', { id: `DRAFT-${TASK}` }))
    const w = witnessOf(draft, draft.entries.findLast((e) => e.tool === 'gmail.drafts.get')!)
    assert.ok((w.all ?? []).length > 0 && w.all!.every((f) => f.startsWith('"body_text":"')))
    assert.ok(shows(draft.stdout, w))
  } finally {
    await r.close()
  }
})

test('a kit written before the mounts is refused, not read without witnesses', { skip }, () => {
  const state = mkdtempSync(join(tmpdir(), 'erpbench-old-kit-'))
  try {
    mkdirSync(join(state, 'kit'))
    const kit = JSON.parse(readFileSync(KIT, 'utf8'))
    delete kit.witnesses
    writeFileSync(join(state, 'kit', `${TASK}.json`), JSON.stringify(kit))
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import { kitOf } from './datasets/erpbench/mocks/erpbench/run.ts'; kitOf('${TASK}')`], {
      cwd: ROOT,
      env: { ...process.env, ERPBENCH_STATE: state },
      encoding: 'utf8',
    })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /has no witnesses: run datasets\/erpbench\/download.py again/)
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
})

test('the inbox and the drafts are separate labels', { skip }, async () => {
  const r = await open()
  try {
    const names = async (path: string) => (await r.line(`ls ${path}`)).stdout.split('\n').filter(Boolean)
    assert.equal((await names('/gmail/INBOX/2026-02-09')).length, 5)
    assert.deepEqual(await names('/gmail/DRAFT'), [])
    await r.post('gmail.drafts.create', { task_id: TASK, to: 'a@b.example', subject: 'Re: x', body: 'Draft body 4471' })
    assert.ok(!(await names('/gmail/INBOX/2026-02-09')).some((n) => n.includes('DRAFT-')))
    assert.equal((await names('/gmail/DRAFT/*')).length, 1)
  } finally {
    await r.close()
  }
})

test('a sheet renders whatever ranges were written', { skip }, async () => {
  const r = await open()
  try {
    const writes: [string, string][] = [
      ['Register', 'bare tab 4471'],
      ['Register!A:H', 'whole columns 4471'],
      ["'Register'!A21", 'quoted tab 4471'],
      ['Nope!A1', 'unknown tab 4471'],
    ]
    for (const [range, value] of writes)
      await r.post('google_sheets.spreadsheets.values.update', {
        task_id: TASK,
        spreadsheetId: 'SHEET-NBR-OPS',
        range,
        valueInputOption: 'RAW',
        values: [[value]],
      })
    const sheet = await r.line('cat /sheets/owned/*__SHEET-NBR-OPS.gsheet.json')
    assert.equal(sheet.exit, 0, sheet.stderr)
    const ranges = new Set(of(sheet.entries, 'google_sheets.spreadsheets.values.get').map((e) => e.arguments.range))
    for (const [range, value] of writes) {
      assert.ok(ranges.has(range), range)
      assert.ok(sheet.stdout.includes(value), value)
    }
  } finally {
    await r.close()
  }
})

test('sizes a listing gives agree with the bytes a read returns', { skip }, async () => {
  const r = await open()
  try {
    for (const path of [`/gmail/INBOX/*/*__MSG-${TASK}-REQUEST.gmail.json`, '/slack/channels/ops-nbr__*/2026-02-09/chat.jsonl']) {
      const size = await r.line(`stat -c %s ${path}`)
      const bytes = await r.line(`cat ${path} | wc -c`)
      assert.equal(size.stdout.trim(), bytes.stdout.trim(), path)
      const once = await r.line(`cat ${path}`)
      const twice = await r.line(`cat ${path}`)
      assert.equal(once.stdout, twice.stdout, path)
    }
  } finally {
    await r.close()
  }
})

test('a recursive grep over each mount stays well inside an agent command yield', { skip }, async () => {
  const r = await open()
  try {
    for (const mount of r.mounts) {
      const out = await r.line(`grep -r zzqnomatch ${mount}`)
      assert.ok(out.ended - out.started < 5000, `${mount}: ${out.ended - out.started} ms`)
    }
  } finally {
    await r.close()
  }
})
