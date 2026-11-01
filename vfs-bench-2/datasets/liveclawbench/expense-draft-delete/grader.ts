import { type Grader, eq, orderBy, grade } from '../../../workspace/grader.ts'
import { EXPENSE } from '../graders/workspace.ts'
export const grader: Grader = (c) => {
    try {
      const user = c
        .rows(EXPENSE, 'user')
        .filter(
          (r) => eq(r.email, 'alice@mosi.inc') && eq(r.password, 'password123') && eq(r.is_active, 1)
        )[0]
      if (!user) return grade(0)
      const codes = new Set(
        c
          .rows(EXPENSE, 'expense_draft')
          .filter((r) => eq(r.user_id, user.id))
          .sort(orderBy(['created_at', -1]))
          .slice(0, 20)
          .map((r) => r.draft_code)
      )
      const total = c.rows(EXPENSE, 'expense_draft').filter((r) => eq(r.user_id, user.id)).length,
        remaining = [...codes].filter((x) => ['EXP-001', 'EXP-002'].includes(x))
      return grade((remaining.length === 1 && codes.size === 1 ? 0.5 : 0) + (total === 1 ? 0.5 : 0))
    } catch {
      return grade(0)
    }
  }
