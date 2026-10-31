/**
 * The web fake's routes: upstream's `server.py`, each statement kept, over
 * the run's lists. `search_items` and `pages` are the fixture's search
 * results and pages; `notifications` is each notification upstream records.
 *
 * Upstream's search tokenizes with Python's string semantics, which differ
 * from JavaScript's: a string is indexed by code point, not UTF-16 unit, and
 * `str.split()` takes a whitespace set of its own.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict, Json } from '../claweval/store.ts'
import type { C } from './config.ts'

const SEARCH = { query: REQUIRED, max_results: opt(10) }
const FETCH = { url: REQUIRED, timeout_seconds: opt(30) }
const NOTIFY = { channel: REQUIRED, message: REQUIRED, recipients: opt([]) }

/** The characters Python's `str.split()` splits on. */
const SPACES = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u

/** What upstream's tokenizer strips from each end of a word. */
const PUNCT = new Set(Array.from(',.!?;:"\'()[]{}。，！？；：\'\'（）【】《》'))

/** Python's `d.get(key, default)`. */
const get = (d: Dict, key: string, fallback: Json): Json => (key in d ? d[key]! : fallback)

/** Python's `word.strip(chars)`. */
function strip(word: string): string {
  const chars = Array.from(word)
  let start = 0
  let end = chars.length
  while (start < end && PUNCT.has(chars[start]!)) start++
  while (end > start && PUNCT.has(chars[end - 1]!)) end--
  return chars.slice(start, end).join('')
}

const isCjk = (c: string): boolean => c >= '\u4e00' && c <= '\u9fff'

/** Upstream's `_tokenize`: lowercase words, then single CJK characters and CJK bigrams. */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const word of text.toLowerCase().split(SPACES)) {
    const clean = strip(word)
    if (clean) tokens.add(clean)
  }
  const chars = Array.from(text)
  for (const c of chars) if (isCjk(c)) tokens.add(c)
  for (let i = 0; i < chars.length - 1; i++) {
    const c1 = chars[i]!
    const c2 = chars[i + 1]!
    if (isCjk(c1) && isCjk(c2)) tokens.add(c1 + c2)
  }
  return tokens
}

function health(): Reply {
  return ok({ status: 'ok' })
}

async function webSearch(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SEARCH)
  if (isReply(req)) return req
  const queryTokens = tokenize(String(req.query))

  const scored: [number, number, Dict][] = []
  for (const [idx, item] of (await load(ctx.db, 'search_items')).entries()) {
    const itemTokens = new Set<string>()
    for (const kw of get(item, 'keywords', []) as string[]) {
      for (const t of tokenize(kw)) itemTokens.add(t)
    }
    let overlap = 0
    for (const t of queryTokens) if (itemTokens.has(t)) overlap++
    if (overlap > 0) scored.push([overlap, idx, item])
  }

  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1])

  const results: Dict[] = []
  for (const [, , item] of scored.slice(0, Number(req.max_results))) {
    results.push({
      url: item.url!,
      title: item.title!,
      snippet: item.snippet!,
      source: get(item, 'source', ''),
      published_at: get(item, 'published_at', ''),
    })
  }

  const resp = { results, total: results.length, query: req.query! }
  await logCall(ctx, '/web/search', req, resp)
  return ok(resp)
}

async function webFetch(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, FETCH)
  if (isReply(req)) return req
  for (const page of await load(ctx.db, 'pages')) {
    if (page.url === req.url) {
      const statusCode = get(page, 'status_code', 200) as number
      let resp: Dict
      if (statusCode >= 400) {
        resp = {
          status_code: statusCode,
          url: req.url!,
          error: get(page, 'error', `HTTP ${statusCode}`),
          content: null,
        }
      } else {
        resp = {
          status_code: statusCode,
          url: req.url!,
          title: get(page, 'title', ''),
          content: get(page, 'content', ''),
          content_type: get(page, 'content_type', 'text/html'),
          fetched_at: pyNow(ctx),
        }
      }
      await logCall(ctx, '/web/fetch', req, resp)
      return ok(resp)
    }
  }

  const resp = {
    status_code: 404,
    url: req.url!,
    error: 'Page not found or unavailable',
    content: null,
  }
  await logCall(ctx, '/web/fetch', req, resp)
  return ok(resp)
}

async function sendNotification(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, NOTIFY)
  if (isReply(req)) return req
  const record = { channel: req.channel!, message: req.message!, recipients: req.recipients!, timestamp: pyNow(ctx) }
  await append(ctx.db, 'notifications', record)
  const resp = { status: 'sent', record }
  await logCall(ctx, '/web/notify', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), notifications: await load(ctx.db, 'notifications') })
}

export function webRoutes(): KitRoute<C>[] {
  return [
    route<C>('GET', '/web/health', health),
    route<C>('POST', '/web/search', webSearch, { write: true }),
    route<C>('POST', '/web/fetch', webFetch, { write: true }),
    route<C>('POST', '/web/notify', sendNotification, { write: true }),
    route<C>('GET', '/web/audit', audit),
  ]
}
