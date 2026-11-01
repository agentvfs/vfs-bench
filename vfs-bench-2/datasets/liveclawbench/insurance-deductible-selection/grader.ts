import { type Grader, eq, orderBy, grade } from '../../../workspace/grader.ts'
import { INSURANCE } from '../graders/health.ts'
export const grader: Grader = (c) => {
    const p = c
      .rows(INSURANCE, 'current_policy')
      .filter((cp) => cp.user_id === 1 && cp.status === 'active')
      .flatMap((cp) => c.rows(INSURANCE, 'insurance_plan').filter((ip) => eq(ip.id, cp.plan_id)))[0]
    if (p?.code !== 'B' || p.name !== 'Balanced Silver') return grade(0)
    const s = c
      .rows(INSURANCE, 'plan_selection')
      .filter((r) => eq(r.user_id, 1))
      .sort(orderBy(['id', -1]))
      .slice(0, 1)[0]
    return grade(s?.plan_code_snapshot === 'B' && s.plan_name_snapshot === 'Balanced Silver' ? 1 : 0)
  }
