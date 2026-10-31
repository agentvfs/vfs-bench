import { type Grader, eq } from '../../../workspace/grader.ts'
import { finance, near } from '../graders/finance.ts'
export const grader: Grader = (c) =>
    finance(c, (d, db) => {
      d.account_flagging =
        c.rows(db, 'account_balance').filter((r) => eq(r.account_id, 'ACC-1002'))[0]?.status === 'flagged'
          ? 0.2
          : 0
      const flagged = new Set(
        c
          .rows(db, 'transaction_record')
          .filter((r) => [2, 4, 8].some((v) => eq(r.id, v)))
          .filter((r) => r.status === 'flagged')
          .map((r) => r.id)
      )
      d.transaction_flagging = [2, 4, 8].every((id) => flagged.has(id)) ? 0.2 : 0
      const report = c.rows(db, 'expense_report').filter((r) => eq(r.trip_name, 'March Marketing Trip'))[0]
      d.expense_report_created = report && near(report.total_amount, 2450) ? 0.2 : 0
      d.expense_report_submitted = report?.status === 'submitted' ? 0.1 : 0
      const invoice = c.rows(db, 'invoice').filter((r) => eq(r.invoice_number, 'INV-2026-004'))[0]
      d.invoice_created = invoice?.vendor_id === 2 && invoice.invoice_date === '2026-03-01' ? 0.2 : 0
      const items = invoice ? c.rows(db, 'invoice_line_item').filter((r) => eq(r.invoice_id, invoice.id)) : []
      d.invoice_line_items =
        items.length === 2 && ['5100', '5400'].every((code) => items.some((i) => i.category_code === code))
          ? 0.1
          : 0
    })
