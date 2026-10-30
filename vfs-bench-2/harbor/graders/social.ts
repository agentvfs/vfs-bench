import DATA from './reference-data.json' with { type: 'json' }
import {
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

/** The read-only social_api.py contract used by the preserved Pyodide graders. */
class Social {
  private c: Context
  constructor(c: Context) {
    this.c = c
  }
  login(username: string): number | null {
    const a = this.c.one(SOCIAL, 'SELECT * FROM account WHERE username=?', username)
    return a && a.password === 'demo123' && a.is_active !== 0 ? a.id : null
  }
  private shadow() {
    const now =
      this.c.scalar(
        SOCIAL,
        'SELECT MAX(t) FROM (SELECT MAX(created_at) AS t FROM post UNION ALL SELECT MAX(updated_at) FROM post UNION ALL SELECT MAX(created_at) FROM post_action_log UNION ALL SELECT MAX(updated_at) FROM comment)'
      ) ?? null
    const due = "status='scheduled' AND REPLACE(scheduled_for,'T',' ')<=?"
    return {
      sql: `WITH post AS (SELECT id,author_account_id,content,CASE WHEN ${due} THEN 'published' ELSE status END AS status,visibility,moderation_state,scheduled_for,scheduled_timezone,CASE WHEN ${due} THEN ? ELSE published_at END AS published_at,deleted_at,is_pinned,has_event_cta,created_at,updated_at FROM main.post)`,
      params: [now, now, now],
    }
  }
  private enriched(post: Row, viewer: number | null): Row {
    return {
      ...post,
      tags: this.c.all(
        SOCIAL,
        'SELECT t.* FROM tag t JOIN post_tag pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY pt.sort_order',
        post.id
      ),
      liked: Boolean(
        viewer &&
          this.c.one(SOCIAL, 'SELECT 1 FROM post_like WHERE post_id=? AND account_id=?', post.id, viewer)
      ),
      like_count: this.c.scalar(SOCIAL, 'SELECT COUNT(*) FROM post_like WHERE post_id=?', post.id),
    }
  }
  list(viewer: number | null, author?: number, includeDeleted = false, limit = 20): Row[] {
    const { sql, params } = this.shadow()
    let where: string,
      p: any[] = []
    if (!viewer) where = "p.status='published' AND p.visibility='public'"
    else {
      const own = includeDeleted && author === viewer
      where =
        "p.visibility!='unlisted' AND ((p.status='published' AND p.visibility='public') OR (p.status='published' AND p.visibility='followers_only' AND EXISTS (SELECT 1 FROM follow_relation fr WHERE fr.follower_account_id=? AND fr.target_account_id=p.author_account_id AND fr.status='following')) OR (p.author_account_id=? AND p.status!='deleted')" +
        (own ? " OR (p.author_account_id=? AND p.status='deleted')" : '') +
        ')'
      p = own ? [viewer, viewer, viewer] : [viewer, viewer]
      const blocked = this.c
        .all(
          SOCIAL,
          "SELECT target_account_id AS id FROM follow_relation WHERE follower_account_id=? AND status='blocked' UNION SELECT follower_account_id AS id FROM follow_relation WHERE target_account_id=? AND status='blocked'",
          viewer,
          viewer
        )
        .map((r) => r.id)
      if (blocked.length) {
        where += ` AND p.author_account_id NOT IN (${blocked.map(() => '?').join(',')})`
        p.push(...blocked)
      }
    }
    if (author !== undefined) {
      where += ' AND p.author_account_id=?'
      p.push(author)
    }
    return this.c
      .all(
        SOCIAL,
        `${sql} SELECT p.*,a.username AS author_username FROM post p JOIN account a ON a.id=p.author_account_id WHERE ${where} ORDER BY p.is_pinned DESC,COALESCE(p.published_at,p.created_at) DESC,p.id DESC LIMIT ? OFFSET 0`,
        ...params,
        ...p,
        limit
      )
      .map((r) => this.enriched(r, viewer))
  }
  detail(id: number, viewer: number): Row | undefined {
    const { sql, params } = this.shadow(),
      p = this.c.one(
        SOCIAL,
        `${sql} SELECT p.*,a.username AS author_username FROM post p JOIN account a ON a.id=p.author_account_id WHERE p.id=?`,
        ...params,
        id
      )
    if (!p) return undefined
    if (
      this.c.one(
        SOCIAL,
        "SELECT 1 FROM follow_relation WHERE status='blocked' AND ((follower_account_id=? AND target_account_id=?) OR (follower_account_id=? AND target_account_id=?))",
        viewer,
        p.author_account_id,
        p.author_account_id,
        viewer
      )
    )
      return undefined
    if (['deleted', 'draft', 'scheduled'].includes(p.status) && viewer !== p.author_account_id)
      return undefined
    if (
      p.status === 'published' &&
      p.visibility === 'followers_only' &&
      viewer !== p.author_account_id &&
      !this.c.one(
        SOCIAL,
        "SELECT 1 FROM follow_relation WHERE follower_account_id=? AND target_account_id=? AND status='following'",
        viewer,
        p.author_account_id
      )
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
    grade(c.one(SOCIAL, 'SELECT id FROM post_like WHERE post_id=1 AND account_id=2') ? 0 : 1),
  'social-post-rate-limit': (c) => {
    const n = c.all(
      SOCIAL,
      'SELECT id,content,created_at FROM post WHERE id>10 ORDER BY created_at ASC'
    ).length
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
      const row = c.one(SOCIAL, 'SELECT status FROM comment WHERE id=?', id)
      if (!row || row.status !== 'visible') score += 0.05
    }
    if (c.scalar(SOCIAL, 'SELECT status FROM comment WHERE id=102') === 'visible') score += 0.1
    if (
      c.one(
        SOCIAL,
        "SELECT c.id FROM comment c LEFT JOIN account a ON c.author_account_id=a.id WHERE c.parent_comment_id=102 AND c.status='visible' AND a.username='mosi_brand'"
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
