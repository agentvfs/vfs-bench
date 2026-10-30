import {
  type Context,
  type Grader,
  FINANCE,
  containsAny,
  dimensions,
  grade,
  lower,
  round,
} from './context.ts'
export const financePath = (c: Context) => c.input.env?.MOCK_FINANCE_DB_PATH ?? FINANCE
export function finance(c: Context, fn: (d: Record<string, number>, db: string) => void) {
  const d: Record<string, number> = {}
  try {
    if (c.exists(financePath(c))) fn(d, financePath(c))
  } catch {}
  return dimensions(
    d,
    round(
      Object.values(d).reduce((a, b) => a + b, 0),
      2
    )
  )
}
const near = (a: any, b: number, tolerance = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tolerance
export const FINANCE_GRADERS: Record<string, Grader> = {
  'finance-budget-shift': (c) => {
    const db = c.exists(FINANCE) ? FINANCE : '/workspace/finance.db'
    const records = c.all(
      db,
      "SELECT department_name, budget_amount, actual_expense_amount FROM department_financial_record WHERE month = '2026-03'"
    )
    const current = new Map(records.map((r) => [r.department_name, r]))
    const base = new Map(
      c
        .all(
          db,
          "SELECT department_name, budget_amount FROM department_financial_record WHERE month = '2026-01'"
        )
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
    const alert = c.one(
      db,
      "SELECT threshold FROM budget_alert WHERE department_name = 'Marketing' AND month = '2026-03'"
    )
    if (alert && budget && Math.abs(alert.threshold - budget * 0.8) < 0.01) d.alert_setup = 0.5
    return dimensions(
      d,
      round(
        Object.values(d).reduce((a, b) => a + b, 0),
        2
      )
    )
  },
  'finance-anomaly-detect': (c) =>
    finance(c, (d, db) => {
      const rows = c.all(db, 'SELECT id, vendor_name, amount, status FROM transaction_record ORDER BY id')
      if (!rows.length) return
      const flagged = new Set(rows.filter((r) => r.status === 'flagged').map((r) => r.id)),
        hits = [8, 9, 10, 11].filter((id) => flagged.has(id)).length
      d.anomaly_detection = round((0.4 * hits) / 4, 4)
      d.no_false_positives = flagged.size && ![1, 2, 3, 4, 5, 6, 7].some((id) => flagged.has(id)) ? 0.3 : 0
      d.no_false_negatives = hits === 4 ? 0.3 : 0
    }),
  'finance-depreciation-audit': (c) =>
    finance(c, (d, db) => {
      const corrected = [
          [2, 18000],
          [4, 20000],
          [6, 4500],
        ],
        unchanged = [
          [1, 9000],
          [3, 2700],
          [5, 4500],
          [7, 2700],
        ]
      const matches = (pairs: number[][]) =>
        pairs.filter(([id, value]) =>
          near(c.scalar(db, 'SELECT annual_depreciation FROM asset_record WHERE id = ?', id!), value!)
        ).length
      const count = matches(corrected)
      d.db_corrections = count === 3 ? 0.3 : 0
      d.no_false_corrections = count > 0 && matches(unchanged) === 4 ? 0.15 : 0
      d.correction_reasons = corrected.every(([id]) =>
        String(c.scalar(db, 'SELECT correction_reason FROM asset_record WHERE id = ?', id!) ?? '').trim()
      )
        ? 0.15
        : 0
      const policy = lower(c.text('/workspace/policies/asset_policy.md', ''))
      d.policy_updated = policy.includes('audit result') ? 0.2 : 0
      d.policy_content = ['laptop fleet', 'company vehicle', 'backup generator'].every((t) =>
        policy.includes(t)
      )
        ? 0.2
        : 0
    }),
  'finance-dashboard-repair': (c) => {
    const d: Record<string, number> = {},
      row = c.one(financePath(c), 'SELECT formula_json FROM dashboard_config WHERE user_id = 1')
    const finish = () => {
      const r = dimensions(
        Object.fromEntries(Object.entries(d).map(([k, v]) => ['_meta_' + k, v])),
        round(
          Math.min(
            Object.values(d).reduce((a, b) => a + b, 0),
            1
          ),
          2
        )
      )
      return r
    }
    if (!row) return finish()
    const raw = row.formula_json,
      seed = containsAny(raw, ['total_expenses', 'budget_deviation'])
    let formula: any
    try {
      formula = JSON.parse(raw)
      d.formula_parseable = seed ? 0 : 0.15
    } catch {
      d.formula_parseable = 0
      return finish()
    }
    d.no_deprecated = containsAny(lower(raw), ['total_expenses', 'budget_deviation', 'gross_revenue'])
      ? 0
      : 0.2
    const fields = new Set<any>()
    const visit = (node: any) => {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        if (node.op === 'field' && 'name' in node) fields.add(node.name)
        for (const v of Object.values(node)) {
          if (Array.isArray(v)) v.forEach(visit)
          else if (v && typeof v === 'object') visit(v)
        }
      }
    }
    visit(formula)
    d.valid_fields =
      fields.size &&
      [...fields].every((f) => ['budget_amount', 'actual_expense_amount', 'revenue_amount'].includes(f))
        ? 0.2
        : 0
    const compact = JSON.stringify(formula)
    d.formula_structure = seed
      ? 0
      : (compact.includes('0.1') && compact.includes('0.05') ? 0.05 : 0) +
        (['add', 'subtract', 'multiply'].every((op) => compact.includes(`"op":"${op}"`)) ? 0.05 : 0) +
        (['revenue_amount', 'actual_expense_amount', 'budget_amount'].every((f) => compact.includes(`"${f}"`))
          ? 0.05
          : 0)
    const policy = lower(c.text(c.input.env?.POLICY_PATH ?? '/workspace/policies/dashboard_spec.md', ''))
    const audit = containsAny(policy, ['## audit', '## change log', '## correction log', '## change record'])
    d.policy_audit = audit ? 0.15 : 0
    const correction = containsAny(policy, ['replace', 'correct', 'fix'])
    d.policy_content =
      audit && correction
        ? (policy.includes('total_expenses') && policy.includes('actual_expense_amount') ? 0.075 : 0) +
          (policy.includes('budget_deviation') && policy.includes('budget_amount') ? 0.075 : 0)
        : 0
    return finish()
  },
  'finance-expense-log': (c) =>
    finance(c, (d, db) => {
      const report =
        c.one(db, "SELECT * FROM expense_report WHERE trip_name = 'NYC Client Visit'") ??
        c.one(db, "SELECT * FROM expense_report WHERE id > 2 AND trip_name LIKE '%NYC%'")
      d.expense_report_created = report ? 0.2 : 0
      if (!report) {
        d.correct_categories = 0
        d.correct_amounts = 0
        d.report_submitted = 0
        return
      }
      const items = c.all(
        db,
        'SELECT expense_category, amount FROM expense_item WHERE expense_report_id = ?',
        report.id
      )
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
    }),
  'finance-monthly-close': (c) =>
    finance(c, (d, db) => {
      d.account_flagging =
        c.scalar(db, "SELECT status FROM account_balance WHERE account_id = 'ACC-1002'") === 'flagged'
          ? 0.2
          : 0
      const flagged = new Set(
        c
          .all(db, 'SELECT id, status FROM transaction_record WHERE id IN (2,4,8)')
          .filter((r) => r.status === 'flagged')
          .map((r) => r.id)
      )
      d.transaction_flagging = [2, 4, 8].every((id) => flagged.has(id)) ? 0.2 : 0
      const report = c.one(db, "SELECT * FROM expense_report WHERE trip_name = 'March Marketing Trip'")
      d.expense_report_created = report && near(report.total_amount, 2450) ? 0.2 : 0
      d.expense_report_submitted = report?.status === 'submitted' ? 0.1 : 0
      const invoice = c.one(db, "SELECT * FROM invoice WHERE invoice_number = 'INV-2026-004'")
      d.invoice_created = invoice?.vendor_id === 2 && invoice.invoice_date === '2026-03-01' ? 0.2 : 0
      const items = invoice
        ? c.all(db, 'SELECT category_code FROM invoice_line_item WHERE invoice_id = ?', invoice.id)
        : []
      d.invoice_line_items =
        items.length === 2 && ['5100', '5400'].every((code) => items.some((i) => i.category_code === code))
          ? 0.1
          : 0
    }),
  'finance-invoice-process': (c) =>
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
        const inv = c.one(db, 'SELECT * FROM invoice WHERE invoice_number = ?', `INV-2026-0${n}`)
        d[`invoice_${n}_created`] = inv?.vendor_id === vendor && inv.invoice_date === date ? 0.3 : 0
        const items = inv
          ? c.all(db, 'SELECT category_code, amount FROM invoice_line_item WHERE invoice_id = ?', inv.id)
          : []
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
    }),
  'finance-portfolio-rebalancing': (c) => {
    let score = 0
    try {
      const db = financePath(c),
        holdings = new Map(
          c
            .all(db, 'SELECT asset_class_code, current_value FROM portfolio_holding')
            .map((r) => [r.asset_class_code, r.current_value])
        )
      if (
        Object.entries({ eq: 112500, fi: 75000, ca: 37500, al: 25000 }).every(([k, v]) =>
          near(holdings.get(k), v, 1)
        )
      )
        score = 1
      else {
        const seed = new Set(['eq,buy,5000', 'fi,sell,3000', 'al,buy,2000'])
        const orders = c
          .all(db, 'SELECT asset_class_code, direction, amount FROM portfolio_order')
          .filter((o) => !seed.has([o.asset_class_code, o.direction, o.amount].join(',')))
        score =
          (
            [
              ['eq', 'buy', 12500],
              ['fi', 'sell', 5000],
              ['ca', 'sell', 12500],
              ['al', 'buy', 5000],
            ] as const
          ).filter(([code, dir, value]) =>
            orders.some((o) => o.asset_class_code === code && o.direction === dir && near(o.amount, value, 1))
          ).length / 4
      }
    } catch {}
    return {
      ...grade(score),
      rewards: {
        reward: round(score, 2),
        holdings_correct: score === 1 ? 1 : 0,
        ...(score < 1 ? { orders_score: round(score, 2) } : {}),
      },
    }
  },
}
