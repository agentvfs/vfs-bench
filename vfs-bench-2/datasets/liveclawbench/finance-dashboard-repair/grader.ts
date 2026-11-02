import { type Grader, eq, containsAny, dimensions, lower, round } from '../../../workspace/grader.ts'
import { financePath } from '../graders/finance.ts'
export const grader: Grader = (c) => {
    const d: Record<string, number> = {},
      row = c.rows(financePath(c), 'dashboard_config').filter((r) => eq(r.user_id, 1))[0]
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
  }
