import { type Grader, eq, asciiLower, type Row, grade, round } from '../../../workspace/grader.ts'
import { MINT, close } from '../graders/health.ts'
export const grader: Grader = (c) => {
    if (!c.exists(MINT)) return grade(0)
    const entries: Row[] = c.rows(MINT, 'food_entry').flatMap((e) =>
      c
        .rows(MINT, 'daily_log')
        .filter(
          (l) =>
            eq(l.id, e.daily_log_id) &&
            l.log_date === '2026-05-06' &&
            (asciiLower(e.food_name) === 'banana' || e.food_name === '香蕉')
        )
        .map((l) => ({ ...e, total_calories_kcal: l.total_calories_kcal }))
    )
    let score = entries.length ? 0.4 : 0
    if (entries.some((r) => r.meal_slot === 'snacks')) score += 0.3
    if (entries.some((r) => close(r.quantity_value, 120, 0.05) && r.quantity_unit === 'g')) score += 0.2
    if (entries.some((r) => close(r.total_calories_kcal, 107, 0.05))) score += 0.1
    return grade(round(score, 2))
  }
