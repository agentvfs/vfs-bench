import {
  compare,
  eq,
  ne,
  gt,
  le,
  orderBy,
  type Context,
  type Grader,
  type Row,
  SOCIAL,
  containsAny,
  grade,
  lower,
  mails,
  mailText,
  round,
} from './context.ts'
import DATA from './reference-data.json' with { type: 'json' }

/** The read-only social_api.py contract used by the preserved Pyodide graders. */
class Social {
  private c: Context
  constructor(c: Context) {
    this.c = c
  }
  login(username: string): number | null {
    const a = this.c.rows(SOCIAL, 'account').find((a) => eq(a.username, username))
    return a && a.password === 'demo123' && a.is_active !== 0 ? a.id : null
  }
  private posts(): Row[] {
    const posts = this.c.rows(SOCIAL, 'post')
    const times = [
      ...posts.flatMap((p) => [p.created_at, p.updated_at]),
      ...this.c.rows(SOCIAL, 'post_action_log').map((p) => p.created_at),
      ...this.c.rows(SOCIAL, 'comment').map((p) => p.updated_at),
    ].filter((t) => t != null)
    const now = times.sort(compare).at(-1) ?? null
    return posts.flatMap((p) => {
      const author = this.c.rows(SOCIAL, 'account').find((a) => eq(a.id, p.author_account_id))
      if (!author) return []
      const due =
        p.status === 'scheduled' && p.scheduled_for != null && le(p.scheduled_for.replaceAll('T', ' '), now)
      return [
        {
          ...p,
          author_username: author.username,
          status: due ? 'published' : p.status,
          published_at: due ? now : p.published_at,
        },
      ]
    })
  }
  private follows(viewer: number, author: number): boolean {
    return this.c
      .rows(SOCIAL, 'follow_relation')
      .some(
        (f) =>
          eq(f.follower_account_id, viewer) && eq(f.target_account_id, author) && f.status === 'following'
      )
  }
  private blocked(viewer: number, author: number): boolean {
    return this.c
      .rows(SOCIAL, 'follow_relation')
      .some(
        (f) =>
          f.status === 'blocked' &&
          ((eq(f.follower_account_id, viewer) && eq(f.target_account_id, author)) ||
            (eq(f.follower_account_id, author) && eq(f.target_account_id, viewer)))
      )
  }
  private enriched(post: Row, viewer: number | null): Row {
    const likes = this.c.rows(SOCIAL, 'post_like').filter((l) => eq(l.post_id, post.id))
    return {
      ...post,
      tags: this.c
        .rows(SOCIAL, 'post_tag')
        .filter((pt) => eq(pt.post_id, post.id))
        .sort(orderBy(['sort_order', 1]))
        .flatMap((pt) => this.c.rows(SOCIAL, 'tag').filter((t) => eq(t.id, pt.tag_id))),
      liked: Boolean(viewer && likes.some((l) => eq(l.account_id, viewer))),
      like_count: likes.length,
    }
  }
  list(viewer: number | null, author?: number, includeDeleted = false, limit = 20): Row[] {
    return this.posts()
      .filter((p) => {
        if (author !== undefined && !eq(p.author_account_id, author)) return false
        if (!viewer) return p.status === 'published' && p.visibility === 'public'
        if (!ne(p.visibility, 'unlisted') || this.blocked(viewer, p.author_account_id)) return false
        return (
          (p.status === 'published' &&
            (p.visibility === 'public' ||
              (p.visibility === 'followers_only' && this.follows(viewer, p.author_account_id)))) ||
          (eq(p.author_account_id, viewer) && ne(p.status, 'deleted')) ||
          (includeDeleted && author === viewer && eq(p.author_account_id, viewer) && p.status === 'deleted')
        )
      })
      .sort(
        (a, b) =>
          compare(b.is_pinned, a.is_pinned) ||
          compare(b.published_at ?? b.created_at, a.published_at ?? a.created_at) ||
          compare(b.id, a.id)
      )
      .slice(0, limit)
      .map((p) => this.enriched(p, viewer))
  }
  detail(id: number, viewer: number): Row | undefined {
    const p = this.posts().find((p) => eq(p.id, id))
    if (!p || this.blocked(viewer, p.author_account_id)) return undefined
    if (['deleted', 'draft', 'scheduled'].includes(p.status) && viewer !== p.author_account_id)
      return undefined
    if (
      p.status === 'published' &&
      p.visibility === 'followers_only' &&
      viewer !== p.author_account_id &&
      !this.follows(viewer, p.author_account_id)
    )
      return undefined
    return this.enriched(p, viewer)
  }
}
function f1(expected: string[], actual: string[]): number {
  const e = new Set(expected.map(lower)),
    a = new Set(actual.map(lower))
  if (!a.size || !e.size) return 0
  const matches = [...e].filter((v) => a.has(v)).length,
    p = matches / a.size,
    r = matches / e.size
  return p + r ? (2 * p * r) / (p + r) : 0
}
const tokens = (s: string) => lower(s).trim().split(/\s+/u).filter(Boolean)
export const SOCIAL_GRADERS: Record<string, Grader> = {
  'social-media-posting': (c) => {
    const s = new Social(c)
    return grade(
      s.login('alice') !== null && s.list(null).some((p) => p.content === 'Hello from the test!') ? 1 : 0
    )
  },
  'social-unlike-post': (c) => {
    const s = new Social(c),
      user = s.login('alice')
    if (user === null) return grade(0)
    const p = s.list(user).find((p) => p.id === 1)
    return grade(p ? (p.liked ? 0 : 0.5) + (p.like_count === 0 ? 0.5 : 0) : 0)
  },
  'social-unlike-verify': (c) =>
    grade(c.rows(SOCIAL, 'post_like').filter((r) => eq(r.post_id, 1) && eq(r.account_id, 2))[0] ? 0 : 1),
  'social-post-rate-limit': (c) => {
    const n = c
      .rows(SOCIAL, 'post')
      .filter((r) => gt(r.id, 10))
      .sort(orderBy(['created_at', 1])).length
    return grade(n >= 3 ? 1 : n ? 0.3 : 0)
  },
  'social-keyword-cleanup': (c) => {
    const s = new Social(c),
      user = s.login('mosi_brand')
    if (user === null) return grade(0)
    const posts = s.list(user, 1, true, 100),
      count = [9, 101, 102, 201, 202, 205].filter((id) =>
        posts.some((p) => p.id === id && p.status === 'deleted')
      ).length
    return grade(
      round(
        count * 0.1 + (count === 6 && posts.some((p) => p.id === 103 && p.status === 'published') ? 0.4 : 0),
        1
      )
    )
  },
  'social-comment-moderation': (c) => {
    let score = 0
    for (const id of [101, 103, 104]) {
      const row = c.rows(SOCIAL, 'comment').filter((r) => eq(r.id, id))[0]
      if (!row || row.status !== 'visible') score += 0.05
    }
    if (c.rows(SOCIAL, 'comment').filter((r) => eq(r.id, 102))[0]?.status === 'visible') score += 0.1
    if (
      c
        .rows(SOCIAL, 'comment')
        .find(
          (row) =>
            row.parent_comment_id === 102 &&
            row.status === 'visible' &&
            c
              .rows(SOCIAL, 'account')
              .some((a) => eq(a.id, row.author_account_id) && a.username === 'mosi_brand')
        )
    )
      score += 0.75
    else score = Math.min(score, 0.4)
    return grade(score)
  },
  'social-cross-publish': (c) => {
    const s = new Social(c),
      user = s.login('mosi_brand')
    if (user === null) return grade(0)
    const p = s
      .list(user, 1, false, 100)
      .find(
        (p) =>
          ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(p.id) &&
          containsAny(lower(p.content), ['tech summit', 'summer tech'])
      )
    if (!p) return grade(0)
    const content = lower(p.content),
      published = p.status === 'published'
    let score =
      (published ? 0.05 : 0) +
      (p.author_username === 'mosi_brand' || p.author_account_id === 1 ? 0.05 : 0) +
      (containsAny(content, ['early bird', 'june 30', 'save 30', '50+ speaker']) ? 0.1 : 0)
    const combined =
      content +
      ' ' +
      p.tags
        .map((t: any) => t.label_text ?? '')
        .join(' ')
        .toLowerCase()
    score +=
      0.5 *
      f1(['#techsummit2026', '#summersummit', '#techconference'], combined.match(/#[\p{L}\p{N}_]+/gu) ?? [])
    const calendar = containsAny(content, ['june 15', 'jun 15', '6/15', '06/15'])
    if (calendar) score += 0.3
    if (!calendar || !published) score = Math.min(score, 0.4)
    return grade(round(score, 1))
  },
  'social-pinned-post-update': (c) => {
    const s = new Social(c),
      user = s.login('mosi_brand')
    if (user === null) return grade(0)
    const posts = s.list(user, 1, false, 100),
      old = posts.find((p) => p.id === 1)?.is_pinned === 0,
      latest = posts.find((p) => p.id === 9)?.is_pinned === 1
    let email = false
    try {
      email = mails(c)
        .reverse()
        .filter((m) => m.to.some((t) => lower(t) === 'social-team@mosi.inc'))
        .slice(0, 50)
        .some((m) => {
          const text = mailText(m),
            l = lower(text)
          return (
            text.includes('SM-Q2-7842') &&
            containsAny(l, ['10k', 'giveaway']) &&
            l.includes('launch') &&
            l.includes('unpinned')
          )
        })
    } catch {}
    const score = (old ? 0.1 : 0) + (latest ? 0.3 : 0) + (email ? 0.6 : 0)
    return grade(round(old && latest ? score : Math.min(score, 0.4), 1))
  },
  'social-event-campaign': (c) => {
    let published = false,
      email = 0
    try {
      const s = new Social(c),
        user = s.login('mosi_brand')
      published = user !== null && s.detail(101, user)?.status === 'published'
    } catch {}
    try {
      const m = mails(c)
        .reverse()
        .find((m) => m.to.includes('events@mosi.inc'))
      if (m) email = 0.7 * f1(tokens('Event Campaign Published'), tokens(m.subject))
    } catch {}
    const score = (published ? 0.3 : 0) + email
    return grade(round(published && email ? score : Math.min(score, 0.4), 1))
  },
  'social-data-anomaly-report': (c) => {
    const recipient = 'data-team@mosi.inc',
      subject = 'social media data anomaly report'
    const list = mails(c)
      .reverse()
      .filter((m) => m.to.includes(recipient) || lower(m.subject).includes(subject))
    const priority = (m: (typeof list)[number]) =>
      (m.to.includes(recipient) && lower(m.subject).includes(subject) ? 0 : 1) * 2 +
      (m.to.includes(recipient) ? 0 : 1)
    list.sort((a, b) => priority(a) - priority(b))
    const m = list[0]
    if (!m) return grade(0)
    let score = m.to.includes(recipient) ? 0.1 : 0
    if (f1(tokens(subject), tokens(m.subject)) >= 0.5) score += 0.4
    const hits = Object.values(DATA['social-data-anomaly-report'].ANOMALY_KEYWORDS).filter(
      (words) => words.filter((w) => lower(m.body).includes(lower(w))).length >= 2
    ).length
    if (hits >= 2) score += 0.5
    else score = Math.min(score, 0.4)
    return grade(score)
  },
}
