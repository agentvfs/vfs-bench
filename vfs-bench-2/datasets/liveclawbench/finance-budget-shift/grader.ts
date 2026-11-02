import { type Grader, eq, FINANCE, dimensions, round } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const db = c.exists(FINANCE) ? FINANCE : '/workspace/finance.db'
    const records = c.rows(db, 'department_financial_record').filter((r) => eq(r.month, '2026-03'))
    const current = new Map(records.map((r) => [r.department_name, r]))
    const base = new Map(
      c
        .rows(db, 'department_financial_record')
        .filter((r) => eq(r.month, '2026-01'))
        .map((r) => [r.department_name, r.budget_amount])
    )
    const d: Record<string, number> = {}
    if (current.has('Sales') && current.get('Sales')!.actual_expense_amount >= 0) d.a2_fix = 0.2
    if (
      current.size >= 6 &&
      ['HR', 'Finance', 'Operations'].every(
        (dept) => current.has(dept) && base.get(dept) && current.get(dept)!.budget_amount < base.get(dept)
      )
    )
      d.c1_detection = 0.3
    const budget = records.find((r) => r.department_name === 'Marketing')?.budget_amount
    const alert = c
      .rows(db, 'budget_alert')
      .filter((r) => eq(r.department_name, 'Marketing') && eq(r.month, '2026-03'))[0]
    if (alert && budget && Math.abs(alert.threshold - budget * 0.8) < 0.01) d.alert_setup = 0.5
    return dimensions(
      d,
      round(
        Object.values(d).reduce((a, b) => a + b, 0),
        2
      )
    )
  }
