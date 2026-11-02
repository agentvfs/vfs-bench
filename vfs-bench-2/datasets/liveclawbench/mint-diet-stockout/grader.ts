import { type Grader, eq, orderBy, grade } from '../../../workspace/grader.ts'
import { MINT } from '../graders/health.ts'
export const grader: Grader = (c) => {
    let score = 0
    for (const r of c
      .rows(MINT, 'food_entry')
      .sort(orderBy(['id', -1]))
      .slice(0, 5))
      if (r.food_name) {
        score = Math.max(score, 0.3)
        if (
          r.food_catalog_id &&
          c.rows(MINT, 'food_catalog').some((catalog) => eq(catalog.id, r.food_catalog_id))
        )
          return grade(1)
      }
    return grade(score)
  }
