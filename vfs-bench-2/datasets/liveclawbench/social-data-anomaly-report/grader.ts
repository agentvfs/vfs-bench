import { type Grader, grade, lower, mails } from '../../../workspace/grader.ts'
import DATA from '../graders/reference-data.json' with { type: 'json' }
import { f1, tokens } from '../graders/social.ts'
export const grader: Grader = (c) => {
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
  }
