import { type Grader, eq, GWS, containsAny, lower, mails } from '../../../workspace/grader.ts'
import { financePath } from '../graders/finance.ts'
import { finish, amounts } from '../graders/finance-mail.ts'
export const grader: Grader = (c) => {
    const d: Record<string, number> = {}
    try {
      const db = financePath(c)
      if (c.exists(db)) {
        const invoice = c.rows(db, 'invoice').filter((r) => eq(r.invoice_number, 'INV-2026-010'))[0]
        let ok = invoice?.vendor_id === 1 && invoice.invoice_date === '2026-03-01'
        if (ok) {
          const items = c.rows(db, 'invoice_line_item').filter((r) => eq(r.invoice_id, invoice!.id)),
            used = new Set<number>()
          ok =
            items.length === 2 &&
            (
              [
                ['5300', 15000],
                ['5400', 5000],
              ] as const
            ).every(([code, amount]) => {
              const i = items.findIndex(
                (r, i) => !used.has(i) && r.category_code === code && Math.abs(r.amount - amount) < 0.01
              )
              if (i < 0) return false
              used.add(i)
              return true
            })
        }
        d.invoice_created = ok ? 0.15 : 0
      }
    } catch {}
    const policy = c.text('/workspace/policies/tax_policy.md', ''),
      text = lower(policy)
    d.vat_per_invoice = Object.entries({
      'INV-2026-001': 930.03,
      'INV-2026-002': 0,
      'INV-2026-010': 1200,
    }).every(([id, value]) =>
      amounts(policy, id).some((a) => Math.abs(a - value) <= (value > 0 ? value * 0.01 : 0.01))
    )
      ? 0.25
      : 0
    d.vat_total = ['total', 'Total', 'TOTAL', 'Q1 2026', 'quarterly'].some((k) =>
      amounts(policy, k, 200).some((a) => Math.abs(a - 2130.03) <= 2130.03 * 0.01)
    )
      ? 0.15
      : 0
    d.policy_updated =
      containsAny(text, ['filed', 'calculated', 'completed', 'submitted']) &&
      text.includes('q1 2026') &&
      text.includes('total')
        ? 0.2
        : 0
    try {
      const sent = c.exists(GWS) ? mails(c) : [],
        primary = sent.filter((m) => m.to.some((r) => lower(r).includes('tax-authority.gov')))
      const target = primary.length
        ? primary
        : sent.filter((m) => m.to.some((r) => lower(r).includes('tax-authority')))
      d.email_sent = target.some((m) => {
        const t = lower(m.subject + ' ' + m.body)
        return t.includes('vat') && containsAny(t, ['930', '1200', '2130', '2,130', '1,200'])
      })
        ? 0.25
        : 0
    } catch {}
    return finish(d)
  }
