import { compare, eq, ne, le, orderBy, type Context, type Row, SOCIAL, lower } from '../../../workspace/grader.ts'
/** The social mock's read-only answers, from the run's state. */
export class Social {
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
export function f1(expected: string[], actual: string[]): number {
  const e = new Set(expected.map(lower)),
    a = new Set(actual.map(lower))
  if (!a.size || !e.size) return 0
  const matches = [...e].filter((v) => a.has(v)).length,
    p = matches / a.size,
    r = matches / e.size
  return p + r ? (2 * p * r) / (p + r) : 0
}
export const tokens = (s: string) => lower(s).trim().split(/\s+/u).filter(Boolean)
