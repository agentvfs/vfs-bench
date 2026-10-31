import { type Grader, eq, gt, like, asciiLower, grade } from '../../../workspace/grader.ts'
import { MINT, date } from '../graders/health.ts'
export const grader: Grader = (c) => {
    let today = date(c.now())
    try {
      today = new Intl.DateTimeFormat('en-CA', {
        timeZone: c.input.env?.TZ ?? 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(c.now())
    } catch {}
    try {
      const lunch = c
        .rows(MINT, 'food_entry')
        .filter(
          (e) =>
            e.meal_slot === 'lunch' &&
            gt(e.quantity_value, 0) &&
            c.rows(MINT, 'daily_log').some((d) => eq(d.id, e.daily_log_id) && eq(d.log_date, today))
        )
      return grade(
        (lunch.some((e) => asciiLower(e.food_name) === 'milk' || e.food_name === '牛奶') ? 0.5 : 0) +
          (lunch.some((e) => like(e.food_name, '%chicken salad%')) ? 0.5 : 0)
      )
    } catch {
      return grade(0)
    }
  }
