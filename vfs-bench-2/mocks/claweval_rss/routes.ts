/**
 * The rss fake's routes: upstream's `server.py`, each statement kept, over
 * the run's lists. `articles` is the fixture's articles; `published` is
 * each newsletter upstream records.
 *
 * A feed's `categories` is a Python set upstream, listed in the order its
 * strings hash to, which changes with each process's hash seed. Here it is
 * the order the feed's articles first name them.
 */
import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict, Json } from '../claweval/store.ts'
import type { C } from './config.ts'

const FEEDS = { category: opt(null) }
const ARTICLES = { source: opt(null), feed_name: opt(null), category: opt(null), max_results: opt(20) }
const GET = { article_id: REQUIRED }
const PUBLISH = { title: REQUIRED, content: REQUIRED, recipients: opt([]) }
const FEED = { feed_id: REQUIRED }

const copy = (a: Dict): Dict => structuredClone(a)

/** Python's `sorted` of strings: by code point. */
function sorted(strings: string[]): string[] {
  const points = (s: string) => Array.from(s, (c) => c.codePointAt(0)!)
  return strings
    .map((s) => [s, points(s)] as const)
    .sort(([, a], [, b]) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!
      return a.length - b.length
    })
    .map(([s]) => s)
}

/** `f"feed_{n:02d}"`. */
const feedId = (n: number): string => `feed_${String(n).padStart(2, '0')}`

async function listFeeds(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, FEEDS, true)
  if (isReply(req)) return req
  const feeds = new Map<string, { source: Json; categories: Json[]; article_count: number }>()
  for (const a of await load(ctx.db, 'articles')) {
    const src = a.source as string
    const cat = a.category!
    if (req.category && cat !== req.category) continue
    if (!feeds.has(src)) feeds.set(src, { source: src, categories: [], article_count: 0 })
    const feed = feeds.get(src)!
    if (!feed.categories.includes(cat)) feed.categories.push(cat)
    feed.article_count += 1
  }
  const result: Dict[] = []
  for (const [i, src] of sorted([...feeds.keys()]).entries()) {
    const v = feeds.get(src)!
    result.push({
      feed_id: feedId(i + 1),
      source: v.source,
      categories: [...v.categories],
      article_count: v.article_count,
    })
  }
  const resp = { feeds: result, total: result.length }
  await logCall(ctx, '/rss/feeds', req, resp)
  return ok(resp)
}

async function getFeed(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, FEED)
  if (isReply(req)) return req
  const articles = await load(ctx.db, 'articles')
  const sources = sorted([...new Set(articles.map((a) => a.source as string))])
  const feedMap = new Map(sources.map((src, i) => [feedId(i + 1), src]))

  let source: string | undefined = typeof req.feed_id === 'string' ? feedMap.get(req.feed_id) : undefined
  if (source === undefined) {
    if (sources.some((s) => s === req.feed_id)) {
      source = req.feed_id as string
    } else {
      const resp = { error: `Feed ${String(req.feed_id)} not found` }
      await logCall(ctx, '/rss/feeds/get', req, resp)
      return ok(resp)
    }
  }

  const found = articles.filter((a) => a.source === source).map(copy)
  const resp = { feed_id: req.feed_id!, source, articles: found, total: found.length }
  await logCall(ctx, '/rss/feeds/get', req, resp)
  return ok(resp)
}

async function listArticles(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, ARTICLES, true)
  if (isReply(req)) return req
  const sourceFilter = req.source || req.feed_name
  let results: Dict[] = []
  for (const a of await load(ctx.db, 'articles')) {
    if (sourceFilter && a.source !== sourceFilter) continue
    if (req.category && a.category !== req.category) continue
    results.push({
      article_id: a.article_id!,
      title: a.title!,
      source: a.source!,
      category: a.category!,
      published_at: a.published_at!,
      summary: a.summary!,
      word_count: a.word_count!,
    })
  }
  results = results.slice(0, Number(req.max_results))
  const resp = { articles: results, total: results.length }
  await logCall(ctx, '/rss/articles', req, resp)
  return ok(resp)
}

async function getArticle(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const a of await load(ctx.db, 'articles')) {
    if (a.article_id === req.article_id) {
      const resp = copy(a)
      await logCall(ctx, '/rss/articles/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Article ${String(req.article_id)} not found` }
  await logCall(ctx, '/rss/articles/get', req, resp)
  return ok(resp)
}

async function publish(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, PUBLISH)
  if (isReply(req)) return req
  const record = {
    title: req.title!,
    content: req.content!,
    recipients: req.recipients!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'published', record)
  const resp = { status: 'published', record }
  await logCall(ctx, '/rss/publish', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), published: await load(ctx.db, 'published') })
}

export function rssRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/rss/feeds', listFeeds, { write: true }),
    route<C>('POST', '/rss/feeds/get', getFeed, { write: true }),
    route<C>('POST', '/rss/articles', listArticles, { write: true }),
    route<C>('POST', '/rss/articles/get', getArticle, { write: true }),
    route<C>('POST', '/rss/publish', publish, { write: true }),
    route<C>('GET', '/rss/audit', audit),
  ]
}
