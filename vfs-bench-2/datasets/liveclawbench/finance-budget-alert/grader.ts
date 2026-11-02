import { type Grader, GWS, containsAny, lower, mails } from '../../../workspace/grader.ts'
import { finish } from '../graders/finance-mail.ts'
export const grader: Grader = (c) => {
    const d: Record<string, number> = { finance_data_intact: 0 }
    if (!c.exists(GWS)) return finish(d)
    const by = new Map<string, string[]>()
    for (const m of mails(c))
      if (containsAny(lower(m.subject), ['budget', 'alert']))
        for (const to of m.to) {
          const key = lower(to)
          by.set(key, [...(by.get(key) ?? []), lower(m.subject + ' ' + m.body)])
        }
    const departments = [
        ['engineering', 'eng.manager@example.com'],
        ['sales', 'sales.manager@example.com'],
        ['marketing', 'marketing.manager@example.com'],
      ],
      correct = by.size === 3 && departments.every(([, recipient]) => by.has(recipient!))
    d.email_sent_count = correct ? 0.35 : 0
    d.correct_recipients = correct ? 0.35 : 0
    d.email_content = departments.every(([dept, recipient]) => {
      const texts = by.get(recipient!) ?? []
      return (
        texts.some((t) => t.includes(dept!)) &&
        texts.some((t) =>
          containsAny(
            t,
            dept === 'sales'
              ? ['negative', '-5000', '-5,000']
              : ['over budget', 'exceed', '180,000', '200,000', '180000', '200000']
          )
        )
      )
    })
      ? 0.3
      : 0
    return finish(d)
  }
