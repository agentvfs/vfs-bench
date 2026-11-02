import { type Grader, eq, ge, le, type Context, grade, lower, round } from '../../../workspace/grader.ts'
import { HEALTH, date } from '../graders/health.ts'
function daily(c: Context) {
  let points = 0
  try {
    if (
      c
        .rows(HEALTH, 'allergen')
        .filter((r) => eq(r.archived, 0))
        .some((a) => lower(a.name).includes('crab') && a.severity === 'mild')
    )
      points++
  } catch {}
  try {
    const med = c
      .rows(HEALTH, 'medication')
      .filter((r) => eq(r.archived, 0))
      .find((m) => lower(m.name + ' ' + (m.display_name ?? '')).includes('theraflu'))
    if (med) {
      const slots = c.rows(HEALTH, 'medication_intake_slot').filter((r) => eq(r.medication_id, med.id))
      points +=
        med.frequency === 'daily' &&
        slots.length >= 2 &&
        ['09:00', '17:00'].every((t) => slots.some((s) => s.time_hhmm.includes(t)))
          ? 1
          : 0.5
    }
  } catch {}
  try {
    const today = date(c.now()),
      values = c
        .rows(HEALTH, 'health_metric_series')
        .filter(
          (r) =>
            eq(r.metric_type, 'active_energy_kcal') &&
            ge(r.date, today.slice(0, 8) + '01') &&
            le(r.date, today)
        )
        .map((r) => r.value)
    const number = c
      .text('/workspace/output/max_energy.txt')
      .trim()
      .match(/[\d.]+/)
    if (number) {
      const n = Number(number[0])
      if (!Number.isFinite(n)) throw new Error('Invalid float')
      points += values.length && Math.abs(n - Math.max(...values)) < 1 ? 1 : 0.3
    }
  } catch {}
  return grade(round(points / 3, 2))
}
export const grader: Grader = daily
