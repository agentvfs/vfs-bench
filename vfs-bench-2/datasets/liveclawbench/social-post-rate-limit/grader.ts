import { type Grader, gt, orderBy, SOCIAL, grade } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const n = c
      .rows(SOCIAL, 'post')
      .filter((r) => gt(r.id, 10))
      .sort(orderBy(['created_at', 1])).length
    return grade(n >= 3 ? 1 : n ? 0.3 : 0)
  }
