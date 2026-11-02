import { type Grader, eq, lower } from '../../../workspace/grader.ts'
import { finance, near } from '../graders/finance.ts'
export const grader: Grader = (c) =>
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
          near(c.rows(db, 'asset_record').filter((r) => eq(r.id, id!))[0]?.annual_depreciation, value!)
        ).length
      const count = matches(corrected)
      d.db_corrections = count === 3 ? 0.3 : 0
      d.no_false_corrections = count > 0 && matches(unchanged) === 4 ? 0.15 : 0
      d.correction_reasons = corrected.every(([id]) =>
        String(c.rows(db, 'asset_record').filter((r) => eq(r.id, id!))[0]?.correction_reason ?? '').trim()
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
    })
