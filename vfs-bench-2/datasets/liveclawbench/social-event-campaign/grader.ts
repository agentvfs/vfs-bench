import { type Grader, grade, mails, round } from '../../../workspace/grader.ts'
import { Social, f1, tokens } from '../graders/social.ts'
export const grader: Grader = (c) => {
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
  }
