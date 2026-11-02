import { type Grader, orderBy, grade } from '../../../workspace/grader.ts'
import { HEALTH } from '../graders/health.ts'
export const grader: Grader = (c) =>
    grade(
      c
        .rows(HEALTH, 'allergen')
        .sort(orderBy(['id', -1]))
        .slice(0, 5).length > 3 ||
        c
          .rows(HEALTH, 'medication')
          .sort(orderBy(['id', -1]))
          .slice(0, 5).length > 2
        ? 1
        : 0
    )
