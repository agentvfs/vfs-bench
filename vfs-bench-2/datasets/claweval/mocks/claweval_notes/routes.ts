/**
 * The notes fake's routes: upstream's `server.py`, each statement kept, over
 * the run's lists. `notes` is the fixture's notes; `shared` is each share
 * upstream records.
 *
 * Upstream's `days_back` counts back from `MOCK_TODAY` in its environment,
 * at midnight, or else from the wall clock. Here that date is the fixture's
 * `env` doc, where the task sets one, or else the run's clock.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict, Json } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { max_results: opt(10), tag: opt(null), days_back: opt(null), date_from: opt(null), date_to: opt(null) }
const GET = { note_id: REQUIRED }
const SHARE = { note_id: REQUIRED, recipients: REQUIRED }

const DAY_MS = 86_400_000

const copy = (n: Dict): Dict => structuredClone(n)

/** Python's `d.get(key, default)`. */
const get = (d: Dict, key: string, fallback: Json): Json => (key in d ? d[key]! : fallback)

/** Python's `item in container`, for a list or a string. */
function contains(container: Json, item: Json): boolean {
  if (typeof container === 'string') return container.includes(String(item))
  return Array.isArray(container) && container.some((v) => v === item)
}

async function listNotes(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req

  let cutoffDate: string | null = null
  if (req.days_back !== null) {
    const mockToday = (await load(ctx.db, 'env'))[0]?.MOCK_TODAY
    const today = mockToday ? Date.parse(`${String(mockToday)}T00:00:00Z`) : Date.parse(ctx.clock.lastIso())
    const cutoff = today - Number(req.days_back) * DAY_MS
    cutoffDate = new Date(cutoff).toISOString().slice(0, 10)
  }

  const filtered: Dict[] = []
  for (const note of await load(ctx.db, 'notes')) {
    if (req.tag && !contains(get(note, 'tags', []), req.tag)) continue
    const created = get(note, 'created_at', '') as string
    if (req.date_from && created < String(req.date_from)) continue
    if (req.date_to && created > String(req.date_to)) continue
    if (cutoffDate && created < cutoffDate) continue
    filtered.push(note)
  }

  const results: Dict[] = []
  for (const note of filtered.slice(0, Number(req.max_results))) {
    results.push({
      note_id: note.note_id!,
      title: note.title!,
      created_at: note.created_at!,
      participants: get(note, 'participants', []),
      duration_minutes: get(note, 'duration_minutes', 0),
    })
  }
  const resp = { notes: results, total: results.length }
  await logCall(ctx, '/notes/list', req, resp)
  return ok(resp)
}

async function getNote(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const note of await load(ctx.db, 'notes')) {
    if (note.note_id === req.note_id) {
      const resp = copy(note)
      await logCall(ctx, '/notes/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Note ${String(req.note_id)} not found` }
  await logCall(ctx, '/notes/get', req, resp)
  return ok(resp)
}

async function shareNote(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SHARE)
  if (isReply(req)) return req
  const record = { note_id: req.note_id!, recipients: req.recipients!, timestamp: pyNow(ctx) }
  await append(ctx.db, 'shared', record)
  const resp = { status: 'shared', record }
  await logCall(ctx, '/notes/share', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), shared: await load(ctx.db, 'shared') })
}

export function notesRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/notes/list', listNotes, { write: true }),
    route<C>('POST', '/notes/get', getNote, { write: true }),
    route<C>('POST', '/notes/share', shareNote, { write: true }),
    route<C>('GET', '/notes/audit', audit),
  ]
}
