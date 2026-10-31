import { type Grader, orderBy, grade } from '../../../workspace/grader.ts'
import { EXPENSE } from '../graders/workspace.ts'
export const grader: Grader = (c) => {
    const statuses = new Set(
      c
        .rows(EXPENSE, 'expense_draft')
        .sort(orderBy(['id', 1]))
        .map((r) => r.status)
    )
    return grade(statuses.has('submitted') ? 1 : statuses.size > 1 ? 0.3 : 0)
  }
