/**
 * The knowledge base fake's routes: upstream's `server.py`, each statement
 * kept, over the run's lists. `articles` is the fixture's articles;
 * `updates` is each article update upstream records. The date an update
 * stamps on its article is the run's, where upstream's is the wall clock's.
 *
 * Upstream's search tokenizes with Python's string semantics, which differ
 * from JavaScript's: a string is indexed by code point, not UTF-16 unit, and
 * `str.split()` and `str.isspace()` take a whitespace set of their own.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow, save } from '../claweval/store.ts'
import type { Dict } from '../claweval/store.ts'
import type { C } from './config.ts'

const SEARCH = { query: REQUIRED, category: opt(null), max_results: opt(5) }
const GET = { article_id: REQUIRED }
const UPDATE = { article_id: REQUIRED, content: REQUIRED }

const copy = (a: Dict): Dict => structuredClone(a)

/** The characters Python's `str.isspace()` is true of. */
const SPACE = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/u
const SPACES = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u

/** Python's `text[start:stop]`, by code point. */
function slice(text: string, start: number, stop?: number): string {
  return Array.from(text).slice(start, stop).join('')
}

/** Python's `items[:stop]`. */
function head<T>(items: T[], stop: number): T[] {
  return items.slice(0, stop < 0 ? Math.max(items.length + stop, 0) : stop)
}

/** Upstream's `_tokenize_chinese`: space-split words, character bigrams and single CJK characters. */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const word of text.toLowerCase().split(SPACES)) if (word !== '') tokens.add(word)
  const chars = Array.from(text)
  for (let i = 0; i < chars.length - 1; i++) {
    const bigram = chars.slice(i, i + 2).join('').toLowerCase()
    if (!SPACE.test(bigram)) tokens.add(bigram)
  }
  for (const char of chars) {
    const code = char.codePointAt(0)!
    if (code >= 0x4e00 && code <= 0x9fff) tokens.add(char)
  }
  return tokens
}

async function searchArticles(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SEARCH)
  if (isReply(req)) return req
  let results: Dict[] = []
  const queryTokens = tokenize(String(req.query))
  for (const article of await load(ctx.db, 'articles')) {
    if (req.category && article.category !== req.category) continue
    const searchable = String(article.title) + ' ' + (article.tags as string[]).join(' ') + ' ' + String(article.content)
    const searchableTokens = tokenize(searchable)
    if ([...queryTokens].some((t) => searchableTokens.has(t))) {
      results.push({
        article_id: article.article_id!,
        title: article.title!,
        category: article.category!,
        tags: article.tags!,
        last_updated: article.last_updated!,
        views: article.views!,
        snippet: slice(String(article.content), 0, 150) + '...',
      })
    }
  }
  results = head(results, Number(req.max_results))
  const resp = { articles: results, total: results.length }
  await logCall(ctx, '/kb/search', req, resp)
  return ok(resp)
}

async function getArticle(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const article of await load(ctx.db, 'articles')) {
    if (article.article_id === req.article_id) {
      const resp = copy(article)
      await logCall(ctx, '/kb/articles/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Article ${String(req.article_id)} not found` }
  await logCall(ctx, '/kb/articles/get', req, resp)
  return ok(resp)
}

async function updateArticle(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, UPDATE)
  if (isReply(req)) return req
  const articles = await load(ctx.db, 'articles')
  for (const article of articles) {
    if (article.article_id === req.article_id) {
      article.content = req.content!
      article.last_updated = pyNow(ctx).slice(0, 10)
      await save(ctx.db, 'articles', articles)
      await append(ctx.db, 'updates', { article_id: req.article_id!, timestamp: pyNow(ctx) })
      const resp = { status: 'updated', article_id: req.article_id! }
      await logCall(ctx, '/kb/articles/update', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Article ${String(req.article_id)} not found` }
  await logCall(ctx, '/kb/articles/update', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), updates: await load(ctx.db, 'updates') })
}

export function kbRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/kb/search', searchArticles, { write: true }),
    route<C>('POST', '/kb/articles/get', getArticle, { write: true }),
    route<C>('POST', '/kb/articles/update', updateArticle, { write: true }),
    route<C>('GET', '/kb/audit', audit),
  ]
}
