import { type Grader, eq } from '../../../workspace/grader.ts'
import { finance, near } from '../graders/finance.ts'
export const grader: Grader = (c) =>
    finance(c, (d, db) => {
      for (const [n, vendor, date, expected] of [
        [
          10,
          1,
          '2026-03-01',
          [
            ['5300', 15000],
            ['5400', 5000],
          ],
        ],
        [
          11,
          3,
          '2026-03-05',
          [
            ['5400', 8000],
            ['5400', 3500],
          ],
        ],
      ] as const) {
        const inv = c.rows(db, 'invoice').filter((r) => eq(r.invoice_number, `INV-2026-0${n}`))[0]
        d[`invoice_${n}_created`] = inv?.vendor_id === vendor && inv.invoice_date === date ? 0.3 : 0
        const items = inv ? c.rows(db, 'invoice_line_item').filter((r) => eq(r.invoice_id, inv.id)) : []
        const used = new Set<number>()
        const matches =
          items.length === expected.length &&
          expected.every(([code, amount]) => {
            const i = items.findIndex(
              (r, i) => !used.has(i) && r.category_code === code && near(r.amount, amount)
            )
            if (i < 0) return false
            used.add(i)
            return true
          })
        d[`invoice_${n}_items`] = matches ? 0.2 : 0
      }
    })
