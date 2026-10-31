import { type Grader, grade, lower, mails, strip } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    let score = 0
    for (const m of mails(c))
      if (
        lower(m.subject).includes('follow-up on project proposal') ||
        m.to.some((r) => lower(r).includes('john.smith@gmail.com'))
      ) {
        score = Math.max(score, m.subject && m.body && [...strip(m.body)].length > 20 ? 1 : 0.3)
      }
    return grade(score)
  }
