import { type Grader, eq, gt, like, round } from '../../../workspace/grader.ts'
import { finance } from '../graders/finance.ts'
export const grader: Grader = (c) =>
    finance(c, (d, db) => {
      const report =
        c.rows(db, 'expense_report').filter((r) => eq(r.trip_name, 'NYC Client Visit'))[0] ??
        c.rows(db, 'expense_report').filter((r) => gt(r.id, 2) && like(r.trip_name, '%NYC%'))[0]
      d.expense_report_created = report ? 0.2 : 0
      if (!report) {
        d.correct_categories = 0
        d.correct_amounts = 0
        d.report_submitted = 0
        return
      }
      const items = c.rows(db, 'expense_item').filter((r) => eq(r.expense_report_id, report.id))
      const expected: [string, number][] = [
        ['transport', 45],
        ['meals', 85.5],
        ['transport', 32],
        ['flight', 450],
        ['hotel', 750],
      ]
      const categories = items.map((i) => i.expense_category)
      let hits = 0
      for (const [category] of [...expected].sort()) {
        const i = categories.indexOf(category)
        if (i >= 0) {
          hits++
          categories.splice(i, 1)
        }
      }
      d.correct_categories = hits === 5 ? 0.4 : round(0.4 * (hits / 5), 3)
      let amountHits = 0
      for (const [cat, amount] of expected) {
        const matching = items
          .filter((i) => i.expense_category === cat)
          .sort((a, b) => Math.abs(a.amount - amount) - Math.abs(b.amount - amount))
        if (matching.length && Math.abs(matching[0]!.amount - amount) / Math.max(amount, 0.01) <= 0.1)
          amountHits++
      }
      d.correct_amounts = amountHits === 5 ? 0.2 : round(0.2 * (amountHits / 5), 3)
      d.report_submitted = report.status === 'submitted' ? 0.2 : 0
    })
