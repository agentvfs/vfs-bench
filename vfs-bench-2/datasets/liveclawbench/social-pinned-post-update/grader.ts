import { type Grader, containsAny, grade, lower, mails, mailText, round } from '../../../workspace/grader.ts'
import { Social } from '../graders/social.ts'
export const grader: Grader = (c) => {
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
  }
