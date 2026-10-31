import { eq, type Grader, GWS, containsAny, dimensions, lower, mails, round } from '../../../workspace/grader.ts'
import { createHash } from 'node:crypto'
import DATA from './reference-data.json' with { type: 'json' }
import { financePath } from './finance.ts'
const finish = (d: Record<string, number>) =>
  dimensions(
    d,
    round(
      Object.values(d).reduce((a, b) => a + b, 0),
      2
    )
  )
function amounts(text: string, keyword: string, radius = 300): number[] {
  const out: number[] = []
  let from = 0
  const hay = lower(text),
    needle = lower(keyword)
  while (true) {
    const i = hay.indexOf(needle, from)
    if (i < 0) break
    from = i + needle.length
    const context = text.slice(Math.max(0, i - radius), Math.min(text.length, i + needle.length + radius))
    for (const m of context.matchAll(/\$?\s*([\d,]+\.\d{2})/g)) out.push(Number(m[1]!.replaceAll(',', '')))
  }
  return out
}
export const FINANCE_MAIL_GRADERS: Record<string, Grader> = {
  'finance-budget-alert': (c) => {
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
  },
  'finance-tax-prepare': (c) => {
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
  },
  'finance-analysis-generate': (c) => {
    const report = c.text('/workspace/output/report.md', ''),
      text = lower(report),
      d: Record<string, number> = {}
    d.report_exists = [...report].length >= 200 ? 0.1 : 0
    d.report_sections =
      [
        'executive summary',
        'department performance',
        'budget variance',
        'key findings',
        'recommendations',
      ].filter((s) => text.includes(s)).length >= 3
        ? 0.25
        : 0
    if (report) {
      const depts =
        ['engineering', 'sales', 'marketing', 'hr', 'finance', 'operations'].filter((s) => text.includes(s))
          .length >= 3
      const months = containsAny(text, [
        '2026-01',
        '2026-02',
        '2026-03',
        'january',
        'february',
        'march',
        'jan',
        'feb',
        'mar',
      ])
      const values = new Set(
        [...report.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g)]
          .map((m) => Number(m[1]!.replaceAll(',', '')))
          .filter((n) => n >= 1000)
      )
      const seed =
        [
          50000, 55000, 62000, 40000, 38000, 78000, 30000, 32000, 41000, 20000, 19500, 5000, 25000, 23000,
          8000, 35000, 34000, 12000,
        ].filter((n) => values.has(n)).length >= 5
      d.report_data = round(0.25 * ((Number(depts) + Number(months) + Number(seed)) / 3), 4)
    } else d.report_data = 0
    let emailed = false
    try {
      emailed = mails(c).some((m) => m.to.some((r) => lower(r).includes('cfo@acmecorp.com')))
    } catch {}
    d.email_sent = emailed ? 0.2 : 0
    // Python's text-mode read uses universal newlines before hashing.
    const template = c.text('/workspace/policies/report_template.md', '').replace(/\r\n?/g, '\n')
    d.template_updated =
      template &&
      createHash('sha256').update(template).digest('hex') !==
        DATA['finance-analysis-generate'].ORIGINAL_TEMPLATE_HASH
        ? 0.2
        : 0
    return finish(d)
  },
}
