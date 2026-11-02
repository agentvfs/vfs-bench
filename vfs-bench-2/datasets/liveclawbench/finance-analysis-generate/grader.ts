import { type Grader, containsAny, lower, mails, round } from '../../../workspace/grader.ts'
import { createHash } from 'node:crypto'
import DATA from '../graders/reference-data.json' with { type: 'json' }
import { finish } from '../graders/finance-mail.ts'
export const grader: Grader = (c) => {
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
  }
