import { type Grader, GWS, containsAny, dimensions, grade, lower, mails, mailText } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    if (!c.exists(GWS)) return grade(0)
    const accepting = mails(c).filter((m) =>
      containsAny(lower(mailText(m)), [
        'proceed',
        'accept',
        'accepted',
        'go ahead',
        "we'll move forward",
        'we will move forward',
        'confirm the order',
        'place the order',
      ])
    )
    const winner = accepting.some((m) => m.to.includes('sales@asterbyte.io'))
    const loser = accepting.some((m) =>
      m.to.some((a) => ['quotes@northpeak.tech', 'desk@latticepro.ai'].includes(a))
    )
    return dimensions({ acceptance_score: winner ? 0.8 : 0, distractor_score: winner && !loser ? 0.2 : 0 })
  }
