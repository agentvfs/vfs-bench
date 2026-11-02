import { type Grader, containsAny, grade, lower, round } from '../../../workspace/grader.ts'
import { Social, f1 } from '../graders/social.ts'
export const grader: Grader = (c) => {
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
  }
