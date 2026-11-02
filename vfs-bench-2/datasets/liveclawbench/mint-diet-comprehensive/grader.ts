import { type Grader, eq, grade, lower, round } from '../../../workspace/grader.ts'
import DATA from '../graders/reference-data.json' with { type: 'json' }
import { MINT, date, close } from '../graders/health.ts'
export const grader: Grader = (c) => {
    if (!c.exists(MINT)) return grade(0)
    try {
      const today = date(c.now()),
        monday = new Date(today + 'T00:00:00Z')
      monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7))
      const next = date(monday),
        tue = date(new Date(monday.getTime() + 86400000)),
        sun = date(new Date(monday.getTime() + 6 * 86400000))
      const log = c.rows(MINT, 'daily_log').filter((r) => eq(r.log_date, today))[0]
      const entries = log ? c.rows(MINT, 'food_entry').filter((r) => eq(r.daily_log_id, log.id)) : []
      let daily = 0,
        catalog = 0
      for (const [slot, specs] of Object.entries(DATA['mint-diet-comprehensive'].MEAL_SPECS))
        for (const spec of specs) {
          const match = entries.find(
            (e) =>
              e.meal_slot === slot &&
              spec.names.some((n) => lower(e.food_name).includes(lower(n))) &&
              close(e.quantity_value, spec.quantity, spec.quantity * 0.1) &&
              e.quantity_unit === spec.unit &&
              close(e.calories_kcal, spec.calories, spec.calories * 0.1)
          )
          if (match) {
            daily += 0.2 / 7
            if (match.food_catalog_id !== null) catalog++
          }
        }
      daily = Math.min(daily, 0.2)
      const bonus = catalog >= 1 ? 0.05 : 0
      const plan = c.rows(MINT, 'meal_plan').filter((r) => eq(r.title, 'Clean Eating Week'))[0]
      let planScore = 0
      if (plan) {
        if (plan.status === 'active') planScore += 0.1
        if (plan.start_date === next && plan.end_date === sun) planScore += 0.05
        if (lower(plan.notes).includes('lean protein')) planScore += 0.05
        if (plan.target_calories_kcal === 1800) planScore += 0.05
      }
      const items = (day: string) =>
        plan
          ? c
              .rows(MINT, 'meal_plan_item')
              .filter((item) =>
                c
                  .rows(MINT, 'meal_plan_day')
                  .some(
                    (d) =>
                      eq(d.id, item.meal_plan_day_id) && eq(d.meal_plan_id, plan.id) && eq(d.plan_date, day)
                  )
              )
          : []
      const d3 = items(next).length >= 3 ? 0.25 : 0,
        d4 = items(tue).length >= 3 ? 0.25 : 0
      const score = Math.min(round(daily + bonus + planScore + d3 + d4, 2), 1)
      return {
        ...grade(score),
        rewards: {
          reward: score,
          _meta_d1: round(daily, 2),
          _meta_d1_catalog_bonus: round(bonus, 2),
          _meta_d2: round(planScore, 2),
          _meta_d3: d3,
          _meta_d4: d4,
        },
      }
    } catch {
      return grade(0)
    }
  }
