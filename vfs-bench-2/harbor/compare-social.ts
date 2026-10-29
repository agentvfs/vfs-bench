/**
 * Check the social kit fake against upstream's social mock: the same
 * requests to each, on the same seed and clock, and every difference in
 * status, headers, body and the tables each leaves behind.
 *
 *     node harbor/compare-social.ts [task ...]   # from vfs-bench-2/; default every social task
 *
 * Needs Bun and LiveClawBench's checkout (`liveclawbench/setup.py`). For each
 * task, upstream's mock runs as its image runs it (`liveclawbench/mock/
 * serve.ts` under Bun, `TASK_NAME` the task's, the task's seed.json where
 * the image puts its assets), with `fixtures/frozen.ts` freezing `Date` and
 * SQLite's `datetime('now')` at the epoch. The fake is one process for every
 * task (`fakes.ts`), each task a run reset from its committed fixture at the
 * same epoch.
 *
 * The requests are the task's solution's first, then every route and page,
 * signed out and as each account, the error cases of each, and a write of
 * every kind. Two differences are known and allowed: a write's time (the
 * fake's clock moves a second per write, upstream's stays at the epoch),
 * which also moves a later login token's `iat` and `exp` and the order of
 * rows listed by time (each such reply is printed, `ORDER`), and each
 * token's signature (each has its own secret). Anything else is printed,
 * and the check exits 1; with `COMPARE_SOCIAL_DUMP=<dir>`, each such reply
 * is written there in full, upstream's and the fake's.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { start } from '../harness/fakes.ts'
import { Run } from '../harness/runs.ts'
import { PLATFORM } from '../liveclawbench/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TASKS = join(HERE, 'tasks', 'liveclawbench')
const EPOCH = '2026-04-03T09:00:00Z'

/** Every committed task on the social fake. */
const SOCIAL = readdirSync(TASKS)
  .filter((t) => readFileSync(join(TASKS, t, 'environment', 'mirage.yaml'), 'utf8').includes('fixtures/social.json'))
  .sort()

interface Step {
  name: string
  method?: string
  path: string
  /** Which session's token to send: `<name>`, as a cookie, or `<name>:bearer`. */
  as?: string
  headers?: Record<string, string>
  body?: string
  /** Keep the reply's token as this session's. */
  login?: string
}

const JSON_CT = { 'Content-Type': 'application/json' }
const j = (v: unknown) => JSON.stringify(v)
const login = (as: string, user: string): Step => ({
  name: `login ${user}`,
  method: 'POST',
  path: '/api/auth/login',
  headers: JSON_CT,
  body: j({ username: user, password: 'demo123' }),
  login: as,
})
const send = (as: string, name: string, method: string, path: string, body?: unknown): Step => ({
  name,
  method,
  path,
  as,
  ...(body === undefined ? {} : { headers: JSON_CT, body: typeof body === 'string' ? body : j(body) }),
})

/** Each task's solution's requests to the social mock, before the rest. */
const SOLUTIONS: Record<string, Step[]> = {
  'social-unlike-post': [
    login('alice', 'alice'),
    { name: 'feed', path: '/api/posts', as: 'alice' },
    send('alice', 'unlike 1', 'POST', '/api/posts/1/like'),
    { name: 'feed after', path: '/api/posts', as: 'alice' },
  ],
  'social-unlike-verify': [
    login('alice', 'alice'),
    { name: 'feed', path: '/api/posts', as: 'alice' },
    send('alice', 'unlike 1 (its fault)', 'POST', '/api/posts/1/like'),
    { name: 'post 1 still liked', path: '/api/posts/1', as: 'alice' },
    send('alice', 'unlike 1 again', 'POST', '/api/posts/1/like'),
    { name: 'post 1 after', path: '/api/posts/1', as: 'alice' },
    send('alice', 'like 1', 'POST', '/api/posts/1/like'),
    send('alice', 'unlike 1, no fault left', 'POST', '/api/posts/1/like'),
  ],
  'social-media-posting': [
    login('alice', 'alice'),
    send('alice', 'post hello', 'POST', '/api/posts', { content: 'Hello from the test!', visibility: 'public', status: 'published' }),
    { name: 'public feed', path: '/api/posts' },
  ],
  'social-post-rate-limit': [
    login('brand', 'mosi_brand'),
    send('brand', 'post 1', 'POST', '/api/posts', { content: 'Product Update v2.0' }),
    send('brand', 'post 2', 'POST', '/api/posts', { content: 'Customer Spotlight' }),
    send('brand', 'post 3 (its fault)', 'POST', '/api/posts', { content: 'Weekend Reading' }),
    send('brand', 'post 3 again', 'POST', '/api/posts', { content: 'Weekend Reading' }),
    send('brand', 'post 4, no fault left', 'POST', '/api/posts', { content: 'One more' }),
    { name: 'own posts', path: '/api/posts?author_id=1&limit=100', as: 'brand' },
    login('alice', 'alice'),
    send('alice', 'alice posts twice', 'POST', '/api/posts', { content: 'a' }),
  ],
  'social-comment-moderation': [
    login('alice', 'alice'),
    send('alice', 'delete 101', 'DELETE', '/api/comments/101'),
    login('bob', 'bob_creator'),
    send('bob', 'delete 103', 'DELETE', '/api/comments/103'),
    send('alice', 'delete 104', 'DELETE', '/api/comments/104'),
    login('brand', 'mosi_brand'),
    send('brand', 'reply 102', 'POST', '/api/comments/102/reply', { body: 'Thank you for your feedback! The mobile app update is planned for next month. Stay tuned!' }),
    { name: 'comments 101', path: '/api/posts/101/comments', as: 'brand' },
    send('brand', 'reply with scam', 'POST', '/api/comments/102/reply', { body: 'not a scam' }),
    send('brand', 'reply with fake news', 'POST', '/api/comments/102/reply', { body: 'fake news here' }),
    { name: 'page post 101', path: '/posts/101', as: 'brand' },
  ],
  'social-keyword-cleanup': [
    login('brand', 'mosi_brand'),
    { name: 'own posts', path: '/api/posts?author_id=1&limit=100', as: 'brand:bearer' },
    ...[9, 101, 102, 201, 202, 205].map((id) => send('brand:bearer', `delete ${id}`, 'DELETE', `/api/posts/${id}`)),
    { name: 'own posts with deleted', path: '/api/posts?author_id=1&include_deleted=true&limit=100', as: 'brand' },
  ],
  'social-cross-publish': [
    login('brand', 'mosi_brand'),
    send('brand', 'publish', 'POST', '/api/posts', {
      content: 'Summer Tech Summit 2026 is coming up on June 15, 2026! #TechSummit2026 #SummerSummit #TechConference',
      visibility: 'public',
      status: 'published',
      tags: ['#TechSummit2026', '#SummerSummit', '#TechConference'],
      assets: [],
    }),
    { name: 'own posts', path: '/api/posts?author_id=1&limit=100', as: 'brand' },
  ],
  'social-event-campaign': [
    login('brand', 'mosi_brand'),
    { name: 'post 101', path: '/api/posts/101', as: 'brand' },
    send('brand', 'publish 101', 'PUT', '/api/posts/101', { status: 'published', tags: [], assets: [] }),
    { name: 'post 101 after', path: '/api/posts/101', as: 'brand' },
    { name: 'events', path: '/api/analytics/events', as: 'brand' },
  ],
  'social-pinned-post-update': [
    login('brand', 'mosi_brand'),
    send('brand', 'unpin 1', 'POST', '/api/posts/1/pin'),
    send('brand', 'pin 9', 'POST', '/api/posts/9/pin'),
    { name: 'own posts', path: '/api/posts?author_id=1&limit=100', as: 'brand' },
  ],
  'social-data-anomaly-report': [
    login('brand', 'mosi_brand'),
    { name: 'metrics', path: '/api/analytics/metrics', as: 'brand' },
    { name: 'metrics 101', path: '/api/analytics/metrics?post_id=101', as: 'brand' },
    { name: 'own drafts', path: '/api/posts?author_id=1&status=draft', as: 'brand' },
  ],
}

/** Every route and page, signed out and in, its error cases, and a write of every kind. */
const FLOWS: Record<string, Step[]> = {
  open: [
    { name: 'health', path: '/health' },
    { name: 'sentinel', path: '/__mock_sentinel__/social' },
    { name: 'unknown path', path: '/nope' },
    { name: 'unknown api path', path: '/api/nope' },
    { name: 'openapi gated', path: '/openapi.json' },
    { name: 'trailing slash', path: '/api/posts/' },
    { name: 'PATCH posts', method: 'PATCH', path: '/api/posts' },
    { name: 'login page', path: '/' },
    { name: 'home, signed out', path: '/home' },
    { name: 'compose, signed out', path: '/compose' },
    { name: 'page post 1', path: '/posts/1' },
    { name: 'page post 8 (deleted)', path: '/posts/8' },
    { name: 'page post abc', path: '/posts/abc' },
    { name: 'page post 999', path: '/posts/999' },
    { name: 'page post 7 (followers)', path: '/posts/7' },
    { name: 'discover', path: '/discover' },
    { name: 'discover ali', path: '/discover?q=ali' },
    { name: 'discover percent', path: '/discover?q=%25' },
    { name: 'profile, signed out', path: '/profile' },
    { name: 'profile 2, signed out', path: '/profile/2' },
    { name: 'profile 99', path: '/profile/99' },
    { name: 'profile x', path: '/profile/x' },
    { name: 'management, signed out', path: '/management' },
    { name: 'feed', path: '/api/posts' },
    { name: 'feed page 2', path: '/api/posts?page=2&limit=3' },
    { name: 'feed limit 0', path: '/api/posts?limit=0' },
    { name: 'feed limit 500', path: '/api/posts?limit=500&page=-1' },
    { name: 'feed drafts, signed out', path: '/api/posts?status=draft' },
    { name: 'feed published', path: '/api/posts?status=published' },
    { name: 'feed followers only', path: '/api/posts?visibility=followers_only' },
    { name: 'feed author abc', path: '/api/posts?author_id=abc' },
    { name: 'feed author 1', path: '/api/posts?author_id=1' },
    { name: 'post 1', path: '/api/posts/1' },
    { name: 'post 2', path: '/api/posts/2' },
    { name: 'post 7 (followers)', path: '/api/posts/7' },
    { name: 'post 8 (deleted)', path: '/api/posts/8' },
    { name: 'post 5 (scheduled)', path: '/api/posts/5' },
    { name: 'post 999', path: '/api/posts/999' },
    { name: 'post abc', path: '/api/posts/abc' },
    { name: 'post 1.9', path: '/api/posts/1.9' },
    { name: 'comments 1', path: '/api/posts/1/comments' },
    { name: 'comments 101', path: '/api/posts/101/comments' },
    { name: 'comments 7', path: '/api/posts/7/comments' },
    { name: 'comments abc', path: '/api/posts/abc/comments' },
    { name: 'search a', path: '/api/accounts/search?q=a' },
    { name: 'search empty', path: '/api/accounts/search?q=' },
    { name: 'search percent', path: '/api/accounts/search?q=%25' },
    { name: 'search bob page 2', path: '/api/accounts/search?q=o&limit=1&page=2' },
    { name: 'account 1', path: '/api/accounts/1' },
    { name: 'account 4', path: '/api/accounts/4' },
    { name: 'account 99', path: '/api/accounts/99' },
    { name: 'account x', path: '/api/accounts/x' },
    { name: 'followers 1', path: '/api/accounts/1/followers' },
    { name: 'following 2', path: '/api/accounts/2/following?limit=1' },
    { name: 'me, signed out', path: '/api/auth/me' },
    { name: 'rules, signed out', path: '/api/keyword-rules' },
    { name: 'metrics, signed out', path: '/api/analytics/metrics' },
    { name: 'post, signed out', method: 'POST', path: '/api/posts', headers: JSON_CT, body: j({ content: 'x' }) },
    { name: 'bad token cookie', path: '/api/keyword-rules', headers: { Cookie: 'token=abc.def.ghi' } },
    { name: 'empty token cookie', path: '/api/keyword-rules', headers: { Cookie: 'token=; other=1' } },
    { name: 'bearer garbage', path: '/api/keyword-rules', headers: { Authorization: 'Bearer x.y.z' } },
    { name: 'login bad json', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: '{bad' },
    { name: 'login empty body', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: '' },
    { name: 'login no type', method: 'POST', path: '/api/auth/login', body: j({ username: 'alice', password: 'demo123' }) },
    { name: 'login missing password', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'alice' }) },
    { name: 'login wrong password', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'alice', password: 'x' }) },
    { name: 'login unknown', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: j({ username: 'zed', password: 'x' }) },
    { name: 'login array body', method: 'POST', path: '/api/auth/login', headers: JSON_CT, body: '[]' },
    { name: 'logout', method: 'POST', path: '/api/auth/logout' },
  ],
  reads: [
    login('brand', 'mosi_brand'),
    login('alice', 'alice'),
    login('bob', 'bob_creator'),
    login('carol', 'carol_ops'),
    { name: 'me as alice', path: '/api/auth/me', as: 'alice' },
    { name: 'me as alice, bearer', path: '/api/auth/me', as: 'alice:bearer' },
    { name: 'feed as alice', path: '/api/posts', as: 'alice' },
    { name: 'feed as carol', path: '/api/posts', as: 'carol' },
    { name: 'feed as bob', path: '/api/posts?limit=100', as: 'bob' },
    { name: 'own posts', path: '/api/posts?author_id=1&limit=100', as: 'brand' },
    { name: 'own posts with deleted', path: '/api/posts?author_id=1&include_deleted=true&limit=100', as: 'brand' },
    { name: 'own drafts', path: '/api/posts?author_id=2&status=draft', as: 'alice' },
    { name: 'own deleted', path: '/api/posts?author_id=4&status=deleted', as: 'carol' },
    { name: 'scheduled, no author', path: '/api/posts?status=scheduled', as: 'brand' },
    { name: 'own scheduled', path: '/api/posts?author_id=1&status=scheduled', as: 'brand' },
    { name: 'post 7 as alice', path: '/api/posts/7', as: 'alice' },
    { name: 'post 7 as carol', path: '/api/posts/7', as: 'carol' },
    { name: 'post 3 as carol (blocked)', path: '/api/posts/3', as: 'carol' },
    { name: 'post 5 as brand', path: '/api/posts/5', as: 'brand' },
    { name: 'account 2 as carol', path: '/api/accounts/2', as: 'carol' },
    { name: 'account 1 as alice', path: '/api/accounts/1', as: 'alice' },
    { name: 'search as carol', path: '/api/accounts/search?q=a', as: 'carol' },
    { name: 'followers 1 as carol', path: '/api/accounts/1/followers', as: 'carol' },
    { name: 'rules', path: '/api/keyword-rules', as: 'brand' },
    { name: 'rule 1', path: '/api/keyword-rules/1', as: 'brand' },
    { name: 'rule 1 as alice', path: '/api/keyword-rules/1', as: 'alice' },
    { name: 'rule abc', path: '/api/keyword-rules/abc', as: 'brand' },
    { name: 'metrics', path: '/api/analytics/metrics', as: 'brand' },
    { name: 'metrics post 1', path: '/api/analytics/metrics?post_id=1', as: 'brand' },
    { name: 'metrics post 3', path: '/api/analytics/metrics?post_id=3', as: 'brand' },
    { name: 'metrics post x', path: '/api/analytics/metrics?post_id=x', as: 'brand' },
    { name: 'events', path: '/api/analytics/events', as: 'brand' },
    { name: 'events limit 0', path: '/api/analytics/events?limit=0', as: 'brand' },
    { name: 'page home', path: '/home', as: 'brand' },
    { name: 'page home as carol', path: '/home', as: 'carol' },
    { name: 'page compose', path: '/compose', as: 'brand' },
    { name: 'page post 1', path: '/posts/1', as: 'alice' },
    { name: 'page post 5', path: '/posts/5', as: 'brand' },
    { name: 'page management', path: '/management', as: 'brand' },
    { name: 'page management drafts', path: '/management?tab=draft', as: 'alice' },
    { name: 'page management quote', path: "/management?tab=x'y", as: 'brand' },
    { name: 'page calendar', path: '/calendar', as: 'brand' },
    { name: 'page calendar december', path: '/calendar?year=2026&month=11', as: 'brand' },
    { name: 'page discover', path: '/discover?q=bo', as: 'brand' },
    { name: 'page moderation', path: '/settings/moderation', as: 'brand' },
    { name: 'page analytics', path: '/analytics', as: 'brand' },
    { name: 'page profile', path: '/profile', as: 'brand' },
    { name: 'page profile 2', path: '/profile/2', as: 'brand' },
    { name: 'page profile 2 as carol', path: '/profile/2', as: 'carol' },
  ],
  writes: [
    login('brand', 'mosi_brand'),
    login('alice', 'alice'),
    login('carol', 'carol_ops'),
    send('brand', 'post', 'POST', '/api/posts', { content: '  New post #Tech  ', tags: ['#Tech', 'Fresh Tag', '#'], assets: [{ asset_url: 'https://x/y.png', alt_text: 'y' }, {}] }),
    send('brand', 'post empty', 'POST', '/api/posts', { content: '   ' }),
    send('brand', 'post bad json', 'POST', '/api/posts', '{'),
    send('brand', 'post scheduled, no time', 'POST', '/api/posts', { content: 'x', status: 'scheduled' }),
    send('brand', 'post published, with time', 'POST', '/api/posts', { content: 'x', scheduled_for: '2026-05-01 00:00:00' }),
    send('brand', 'post blocked word', 'POST', '/api/posts', { content: 'this is SPAM' }),
    send('brand', 'post hidden word', 'POST', '/api/posts', { content: 'some fake news' }),
    send('brand', 'post draft', 'POST', '/api/posts', { content: 'a draft', status: 'draft' }),
    send('brand', 'post followers only', 'POST', '/api/posts', { content: 'for followers', visibility: 'followers_only' }),
    send('brand', 'post bogus visibility', 'POST', '/api/posts', { content: 'x', visibility: 'private' }),
    send('brand', 'post scheduled past', 'POST', '/api/posts', { content: 'due', status: 'scheduled', scheduled_for: '2026-04-01T00:00:00' }),
    send('brand', 'post scheduled future', 'POST', '/api/posts', { content: 'later', status: 'scheduled', scheduled_for: '2026-12-31 00:00:00' }),
    { name: 'own scheduled, publishes due', path: '/api/posts?author_id=1&status=scheduled', as: 'brand' },
    { name: 'feed publishes due', path: '/api/posts?limit=5', as: 'brand' },
    send('brand', 'put content, no tags', 'PUT', '/api/posts/2', { content: 'x' }),
    send('brand', 'put content', 'PUT', '/api/posts/2', { content: 'Edited #Conference', tags: ['#Conference', '#New'], assets: [] }),
    send('brand', 'put blocked word', 'PUT', '/api/posts/2', { content: 'spam', tags: [], assets: [] }),
    send('brand', 'put bad transition', 'PUT', '/api/posts/2', { status: 'draft', tags: [], assets: [] }),
    send('brand', 'put schedule on published', 'PUT', '/api/posts/2', { scheduled_for: '2026-06-01', tags: [], assets: [] }),
    send('brand', 'put empty', 'PUT', '/api/posts/2', {}),
    send('brand', 'put bogus visibility', 'PUT', '/api/posts/2', { visibility: 'nope', tags: [], assets: [] }),
    send('brand', 'put scheduled to draft', 'PUT', '/api/posts/5', { status: 'draft', tags: [], assets: [] }),
    send('brand', 'put draft to scheduled', 'PUT', '/api/posts/5', { status: 'scheduled', scheduled_for: '2026-12-02 08:00:00', scheduled_timezone: 'UTC', tags: [], assets: [] }),
    send('alice', 'put not author', 'PUT', '/api/posts/2', { tags: [], assets: [] }),
    send('brand', 'put 999', 'PUT', '/api/posts/999', {}),
    send('brand', 'put abc', 'PUT', '/api/posts/abc', {}),
    send('brand', 'put bad json', 'PUT', '/api/posts/2', '{'),
    send('brand', 'delete 9', 'DELETE', '/api/posts/9'),
    send('brand', 'delete 9 again', 'DELETE', '/api/posts/9'),
    send('brand', 'delete 5 (scheduled)', 'DELETE', '/api/posts/5'),
    send('brand', 'restore 9', 'POST', '/api/posts/9/restore'),
    send('brand', 'restore 9 again', 'POST', '/api/posts/9/restore'),
    send('alice', 'restore not author', 'POST', '/api/posts/9/restore'),
    send('brand', 'pin 2', 'POST', '/api/posts/2/pin'),
    send('brand', 'pin 2 again', 'POST', '/api/posts/2/pin'),
    send('alice', 'pin not author', 'POST', '/api/posts/2/pin'),
    send('alice', 'like 2', 'POST', '/api/posts/2/like'),
    send('alice', 'like 8 (deleted)', 'POST', '/api/posts/8/like'),
    send('carol', 'like 7 (followers)', 'POST', '/api/posts/7/like'),
    send('carol', 'like 3 (blocked)', 'POST', '/api/posts/3/like'),
    send('alice', 'repost 2', 'POST', '/api/posts/2/repost'),
    send('alice', 'unrepost 2', 'POST', '/api/posts/2/repost'),
    send('alice', 'repost 999', 'POST', '/api/posts/999/repost'),
    send('alice', 'comment', 'POST', '/api/posts/2/comments', { body: ' Nice! ' }),
    send('alice', 'comment empty', 'POST', '/api/posts/2/comments', { body: '' }),
    send('alice', 'comment bad parent', 'POST', '/api/posts/2/comments', { body: 'x', parent_comment_id: 9999 }),
    send('alice', 'comment blocked', 'POST', '/api/posts/2/comments', { body: 'a scam!' }),
    send('alice', 'comment exact word inside', 'POST', '/api/posts/2/comments', { body: 'scammer' }),
    send('alice', 'comment hidden', 'POST', '/api/posts/2/comments', { body: 'more fake news' }),
    send('carol', 'comment on 7 (followers)', 'POST', '/api/posts/7/comments', { body: 'hi' }),
    send('brand', 'reply to 5', 'POST', '/api/comments/5/reply', { body: 'Thanks Alice!' }),
    send('alice', 'reply to the reply', 'POST', '/api/comments/5/reply', { body: 'You are welcome' }),
    send('brand', 'reply 9999', 'POST', '/api/comments/9999/reply', { body: 'x' }),
    send('brand', 'reply empty', 'POST', '/api/comments/5/reply', { body: '' }),
    { name: 'comments 2', path: '/api/posts/2/comments', as: 'brand' },
    send('brand', 'delete comment 5, not author', 'DELETE', '/api/comments/5'),
    send('alice', 'delete comment 5 with replies', 'DELETE', '/api/comments/5'),
    send('alice', 'delete comment 5 again', 'DELETE', '/api/comments/5'),
    send('alice', 'delete comment 9999', 'DELETE', '/api/comments/9999'),
    send('brand', 'reply to deleted 5', 'POST', '/api/comments/5/reply', { body: 'x' }),
    { name: 'comments 2 after', path: '/api/posts/2/comments', as: 'brand' },
    send('alice', 'put own account', 'PUT', '/api/accounts/2', { bio: 'Hi', location: 'NYC', display_name: 'Alice A.' }),
    send('alice', 'put own account, empty', 'PUT', '/api/accounts/2', {}),
    send('alice', 'put other account', 'PUT', '/api/accounts/1', { bio: 'x' }),
    send('alice', 'follow 4', 'POST', '/api/accounts/4/follow'),
    send('alice', 'unfollow 1', 'POST', '/api/accounts/1/follow'),
    send('alice', 'follow self', 'POST', '/api/accounts/2/follow'),
    send('alice', 'follow 99', 'POST', '/api/accounts/99/follow'),
    send('carol', 'follow 2 (blocked)', 'POST', '/api/accounts/2/follow'),
    send('alice', 'block 3', 'POST', '/api/accounts/3/block'),
    send('alice', 'unblock 3', 'POST', '/api/accounts/3/block'),
    send('alice', 'block self', 'POST', '/api/accounts/2/block'),
    send('carol', 'unblock 2', 'POST', '/api/accounts/2/block'),
    send('brand', 'rule', 'POST', '/api/keyword-rules', { phrase: ' promo ', match_mode: 'prefix', scope: 'comment', action: 'warn' }),
    send('brand', 'rule again', 'POST', '/api/keyword-rules', { phrase: 'promo', match_mode: 'prefix', scope: 'comment' }),
    send('brand', 'rule empty', 'POST', '/api/keyword-rules', { phrase: '' }),
    send('brand', 'rule bogus mode', 'POST', '/api/keyword-rules', { phrase: 'x', match_mode: 'regex' }),
    send('alice', 'comment with warned word', 'POST', '/api/posts/2/comments', { body: 'promotion time' }),
    send('brand', 'put rule 1', 'PUT', '/api/keyword-rules/1', { action: 'warn' }),
    send('brand', 'put rule 99', 'PUT', '/api/keyword-rules/99', {}),
    send('brand', 'toggle rule 2', 'POST', '/api/keyword-rules/2/toggle'),
    send('brand', 'delete rule 3', 'DELETE', '/api/keyword-rules/3'),
    send('alice', 'delete rule 1, not owner', 'DELETE', '/api/keyword-rules/1'),
    { name: 'rules after', path: '/api/keyword-rules', as: 'brand' },
    send('brand', 'switch to 3', 'POST', '/api/auth/switch', { account_id: 3 }),
    send('brand', 'switch to 99', 'POST', '/api/auth/switch', { account_id: 99 }),
    send('brand', 'switch, no id', 'POST', '/api/auth/switch', {}),
    { name: 'own posts after', path: '/api/posts?author_id=1&include_deleted=true&limit=100', as: 'brand' },
    { name: 'page analytics after', path: '/analytics', as: 'brand' },
    { name: 'page management after', path: '/management', as: 'brand' },
    send('brand', 'logout', 'POST', '/api/auth/logout'),
  ],
}

/** A service under test: its base URL and its sessions' tokens. */
class Side {
  readonly tokens = new Map<string, string>()
  readonly base: string

  constructor(base: string) {
    this.base = base
  }

  async send(step: Step) {
    const headers: Record<string, string> = { ...step.headers }
    if (step.as !== undefined) {
      const [who, how] = step.as.split(':')
      const token = this.tokens.get(who!)
      if (token !== undefined) {
        if (how === 'bearer') headers.Authorization = `Bearer ${token}`
        else headers.Cookie = `token=${token}`
      }
    }
    const reply = await fetch(`${this.base}${step.path}`, {
      method: step.method ?? 'GET',
      headers,
      ...(step.body === undefined ? {} : { body: step.body }),
      redirect: 'manual',
    })
    const text = await reply.text()
    const cookie = reply.headers.get('set-cookie')
    const token = cookie === null ? undefined : /^token=([^;]*)/.exec(cookie)?.[1]
    if (step.login !== undefined && token) this.tokens.set(step.login, token)
    return { status: reply.status, type: reply.headers.get('content-type'), location: reply.headers.get('location'), cookie, text }
  }
}

/** A write's time: upstream's frozen clock, the fake's ticking one. */
const STAMP = /2026-04-03[ T]09:\d\d:\d\d(?:\.\d{3}Z)?/g
/** A session token, as its payload without its signature, and with `clock`, its times only as their span. */
const TOKEN = /eyJ[\w-]+\.([\w-]+)\.[\w-]+/g

function masked(text: string, clock: boolean): string {
  const tokens = text.replace(TOKEN, (_m, p: string) => {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, number>
    return `<jwt ${JSON.stringify(clock ? { ...payload, iat: 0, exp: payload.exp! - payload.iat! } : payload)}>`
  })
  return clock ? tokens.replace(STAMP, '<now>') : tokens
}

/**
 * A body with its lists' order set aside: a JSON body's arrays sorted, a
 * page's elements (each `div`, table row, heading and table). The fake's writes are a second apart, upstream's all at the
 * epoch, so rows listed newest first (`ORDER BY created_at DESC`) tie
 * upstream and do not here.
 */
function unordered(text: string): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sort(v)]))
        : value
  try {
    return JSON.stringify(sort(JSON.parse(text)))
  } catch {
    return text.split(/(?=<\/?(?:div|tr|h\d|table|tbody)\b)|\n/).sort().join('\n')
  }
}

/** Where two texts first differ, with a little of each from there. */
function firstDifference(a: string, b: string): string {
  let at = 0
  while (at < a.length && a[at] === b[at]) at++
  const from = Math.max(0, at - 120)
  return `      upstream: ${a.slice(from, at + 480)}\n      fake:     ${b.slice(from, at + 480)}`
}

/** Every table of a SQLite file but sqlite_sequence and the fake's `_env`, rows in order, times masked. */
function tables(file: string): Record<string, string> {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('_env', 'sqlite_sequence')").all() as {
      name: string
    }[]
    const out: Record<string, string> = {}
    for (const { name } of names) out[name] = masked(JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()), true)
    out.sqlite_sequence = JSON.stringify(db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all())
    return out
  } finally {
    db.close()
  }
}

/** The accounts upstream seeds, by id. */
const ACCOUNTS = ['mosi_brand', 'alice', 'bob_creator', 'carol_ops']

/**
 * harbor/social_api.py, which answers the verifiers' requests from a run's
 * SQLite where they cannot reach the mock (Pyodide), against the fake's own
 * answers on the same run: each account's login and a wrong one, the feed
 * as each account and signed out with every filter the verifiers use and
 * more, and every post as each. Each difference is added to `differ`; the
 * number answered the same is returned.
 */
async function checkOffline(ours: Side, file: string, differ: string[]): Promise<number> {
  const ids = new DatabaseSync(file, { readOnly: true }).prepare('SELECT id FROM post ORDER BY id').all() as { id: number }[]
  const requests: { method: string; path: string; viewer: number | null; data?: unknown }[] = []
  for (const user of ACCOUNTS) {
    requests.push({ method: 'POST', path: '/api/auth/login', viewer: null, data: { username: user, password: 'demo123' } })
  }
  requests.push({ method: 'POST', path: '/api/auth/login', viewer: null, data: { username: 'alice', password: 'nope' } })
  requests.push({ method: 'POST', path: '/api/auth/login', viewer: null, data: { username: 'alice' } })
  for (const viewer of [null, 1, 2, 3, 4]) {
    for (const query of [
      '',
      '?limit=100',
      '?author_id=1&limit=100',
      '?author_id=1&include_deleted=true&limit=100',
      `?author_id=${viewer ?? 1}&status=draft`,
      `?author_id=${viewer ?? 1}&status=deleted&limit=100`,
      '?status=published&page=2&limit=3',
      '?visibility=followers_only',
      '?author_id=abc',
      '?limit=0&page=0',
    ]) {
      requests.push({ method: 'GET', path: `/api/posts${query}`, viewer })
    }
    for (const id of [...ids.map((r) => String(r.id)), '999', 'abc']) requests.push({ method: 'GET', path: `/api/posts/${id}`, viewer })
  }
  const tokens = new Map<number, string>()
  for (const [i, user] of ACCOUNTS.entries()) {
    const reply = await fetch(`${ours.base}/api/auth/login`, { method: 'POST', headers: JSON_CT, body: j({ username: user, password: 'demo123' }) })
    tokens.set(i + 1, ((await reply.json()) as { session_token: string }).session_token)
  }
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(HERE)})`,
    'import social_api',
    `social_api.DB_PATH = ${JSON.stringify(file)}`,
    'out = []',
    'for r in json.load(sys.stdin):',
    '    cookie = f"token=offline.{r[\'viewer\']}" if r["viewer"] else None',
    '    out.append(social_api.answer(r["method"], r["path"], r.get("data"), cookie, None))',
    'print(json.dumps(out))',
  ].join('\n')
  const child = spawn('python3', ['-I', '-c', script], { stdio: ['pipe', 'pipe', 'inherit'] })
  child.stdin.end(j(requests))
  const chunks: Buffer[] = []
  for await (const chunk of child.stdout) chunks.push(chunk as Buffer)
  const answers = JSON.parse(Buffer.concat(chunks).toString()) as [number, unknown][]
  let same = 0
  for (const [i, request] of requests.entries()) {
    const headers: Record<string, string> = { ...JSON_CT }
    if (request.viewer !== null) headers.Cookie = `token=${tokens.get(request.viewer)}`
    const reply = await fetch(`${ours.base}${request.path}`, {
      method: request.method,
      headers,
      ...(request.data === undefined ? {} : { body: j(request.data) }),
    })
    const body = (await reply.json()) as Record<string, unknown>
    const [status, offline] = answers[i]!
    // A session is the account's id offline, a signed token from the mock.
    const tokenless = (value: unknown) => j(value).replace(/"session_token":"[^"]*"/, '"session_token":"<token>"')
    if (status === reply.status && tokenless(offline) === tokenless(body)) same++
    else {
      differ.push(
        `offline ${request.method} ${request.path} as ${request.viewer ?? 'nobody'}\n` +
          `      fake:    ${reply.status} ${tokenless(body).slice(0, 600)}\n      offline: ${status} ${tokenless(offline).slice(0, 600)}`,
      )
    }
  }
  return same
}

/** The shared social fake, seeded with each task's committed fixture. */
async function startFake(root: string): Promise<{ url: string; state: string; process: ChildProcess }> {
  mkdirSync(join(root, 'fixtures', 'social'), { recursive: true })
  for (const task of SOCIAL) {
    copyFileSync(join(TASKS, task, 'environment', 'fixtures', 'social.json'), join(root, 'fixtures', 'social', `${task}.json`))
  }
  const child = spawn(
    process.execPath,
    [join(HERE, 'fakes.ts'), '--service', 'social', '--root', root, '--fixture', SOCIAL[0]!, '--log', join(root, 'fake.log')],
    { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TZ: 'UTC' } },
  )
  for await (const line of createInterface({ input: child.stdout! })) {
    if (line.startsWith('FAKE=')) return { ...(JSON.parse(line.slice(5)) as { url: string; state: string }), process: child }
  }
  throw new Error('the social fake exited before it was ready')
}

/** The task's seed.json, as its image's `assets` place it, if any. */
function seedJson(task: string): string | undefined {
  const map = JSON.parse(readFileSync(join(PLATFORM, 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, { assets?: { src: string; dest: string }[] }>
  }
  const asset = map.tasks[task]?.assets?.find((a) => a.dest === '/opt/mock/data/seed.json')
  return asset === undefined ? undefined : join(PLATFORM, '..', asset.src)
}

/** One task's comparison; the number of unexpected differences. */
async function compare(task: string, fake: { url: string; state: string }, scratch: string): Promise<number> {
  const runDir = join(scratch, task)
  const run = new Run(`compare-${task}`, runDir)
  const data = join(runDir, 'mock-data')
  mkdirSync(data, { recursive: true })
  const seed = seedJson(task)
  if (seed !== undefined) copyFileSync(seed, join(data, 'seed.json'))
  const differ: string[] = []
  let same = 0
  let clocked = 0
  let offline = 0
  const reordered: string[] = []
  try {
    const mock = await start(
      {
        name: 'SOCIAL',
        argv: [
          'bun',
          '--preload',
          join(HERE, 'fixtures', 'frozen.ts'),
          join(HERE, '..', 'liveclawbench', 'mock', 'serve.ts'),
          '--mocks',
          join(PLATFORM, 'mocks'),
          '--mock',
          'social',
          '--name',
          'SOCIAL',
        ],
        cwd: PLATFORM,
        env: { MOCK_DATA_DIR: data, TASK_NAME: task, TZ: 'UTC', FROZEN_EPOCH: EPOCH },
      },
      run,
    )
    const name = task.replace(/[^A-Za-z0-9._-]/g, '-')
    const reset = await fetch(`${fake.url}/reset`, {
      method: 'POST',
      headers: JSON_CT,
      body: j({ run: name, fixture: task, epoch: EPOCH }),
    })
    if (!reset.ok) throw new Error(`resetting the fake's run for ${task}: ${reset.status} ${await reset.text()}`)
    const upstream = new Side(mock.url)
    const ours = new Side(`${fake.url}/_run/${name}`)
    for (const [flow, steps] of [['solution', SOLUTIONS[task] ?? []] as const, ...Object.entries(FLOWS)]) {
      for (const step of steps) {
        const a = await upstream.send(step)
        const b = await ours.send(step)
        const problems: string[] = []
        let byClock = false
        if (a.status !== b.status) problems.push(`status ${a.status} vs ${b.status}`)
        if (a.type !== b.type) problems.push(`content-type ${a.type} vs ${b.type}`)
        if (a.location !== b.location) problems.push(`location ${a.location} vs ${b.location}`)
        for (const [what, x, y] of [
          ['set-cookie', a.cookie ?? '', b.cookie ?? ''],
          ['body', a.text, b.text],
        ] as const) {
          if (masked(x, false) === masked(y, false)) continue
          if (masked(x, true) === masked(y, true)) byClock = true
          else if (unordered(masked(x, true)) === unordered(masked(y, true))) {
            byClock = true
            reordered.push(`${step.name} (${what})`)
          } else {
            problems.push(`${what}\n${firstDifference(masked(x, true), masked(y, true))}`)
            const dump = process.env.COMPARE_SOCIAL_DUMP
            if (dump !== undefined) {
              mkdirSync(dump, { recursive: true })
              const file = join(dump, `${task}.${step.name.replace(/\W+/g, '-')}.${what}`)
              writeFileSync(`${file}.upstream`, x)
              writeFileSync(`${file}.fake`, y)
            }
          }
        }
        if (problems.length > 0) differ.push(`[${flow}] ${step.name} (${step.method ?? 'GET'} ${step.path})\n    ${problems.join('\n    ')}`)
        else if (byClock) clocked++
        else same++
      }
    }
    const theirs = tables(join(data, 'social', 'social.db'))
    const kit = readdirSync(fake.state).find((e) => e.startsWith('mirage-kit-social-'))!
    const mine = tables(join(fake.state, kit, `${name}.db`))
    for (const table of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      if (theirs[table] !== mine[table]) {
        differ.push(`table ${table}\n      upstream: ${theirs[table]?.slice(0, 600)}\n      fake:     ${mine[table]?.slice(0, 600)}`)
      }
    }
    offline = await checkOffline(ours, join(fake.state, kit, `${name}.db`), differ)
  } finally {
    await run.stop()
  }
  for (const line of differ) console.log(`DIFF ${task} ${line}`)
  for (const line of reordered) console.log(`ORDER ${task} ${line}: the same rows, in the clock's order`)
  console.log(
    `${differ.length === 0 ? 'ok' : 'FAIL'} ${task}: ${same} the same, ${clocked} the same but for the clock, ` +
      `${offline} answered the same offline, ${differ.length} differ`,
  )
  return differ.length
}

async function main(): Promise<number> {
  process.env.TZ = 'UTC'
  const tasks = process.argv.slice(2)
  for (const task of tasks) if (!SOCIAL.includes(task)) throw new Error(`${task} is not a committed social task`)
  const scratch = mkdtempSync(join(tmpdir(), 'vfsbench-compare-social-'))
  const fake = await startFake(join(scratch, 'fake'))
  let failed = 0
  try {
    for (const task of tasks.length > 0 ? tasks : SOCIAL) failed += await compare(task, fake, scratch)
  } finally {
    fake.process.stdin!.end()
    await new Promise((resolve) => fake.process.once('exit', resolve))
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log(failed === 0 ? 'no unexpected differences' : `${failed} unexpected differences`)
  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
