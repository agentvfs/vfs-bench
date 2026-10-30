import DATA from './reference-data.json' with { type: 'json' }
import { type Grader, type Context, GWS, grade, lower, round } from './context.ts'
import { iso } from './calendar.ts'
const HEALTH = '/var/lib/mock-data/health/health.db',
  MINT = '/var/lib/mock-data/mint-diet/mint-diet.sqlite',
  INSURANCE = '/var/lib/mock-data/insurance/insurance.db'
const date = (d: Date) => d.toISOString().slice(0, 10)
const close = (a: any, b: number, t: number) => typeof a === 'number' && Math.abs(a - b) <= t
function daily(c: Context) {
  let points = 0
  try {
    if (
      c
        .all(HEALTH, 'SELECT name, severity FROM allergen WHERE archived = 0')
        .some((a) => lower(a.name).includes('crab') && a.severity === 'mild')
    )
      points++
  } catch {}
  try {
    const med = c
      .all(HEALTH, 'SELECT id,name,display_name,frequency FROM medication WHERE archived = 0')
      .find((m) => lower(m.name + ' ' + (m.display_name ?? '')).includes('theraflu'))
    if (med) {
      const slots = c.all(
        HEALTH,
        'SELECT time_hhmm FROM medication_intake_slot WHERE medication_id = ?',
        med.id
      )
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
        .all(
          HEALTH,
          "SELECT value FROM health_metric_series WHERE metric_type = 'active_energy_kcal' AND date >= ? AND date <= ?",
          today.slice(0, 8) + '01',
          today
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
export const HEALTH_GRADERS: Record<string, Grader> = {
  'health-daily-record': daily,
  'health-record-verify': (c) =>
    grade(
      c.all(HEALTH, 'SELECT id FROM allergen ORDER BY id DESC LIMIT 5').length > 3 ||
        c.all(HEALTH, 'SELECT id FROM medication ORDER BY id DESC LIMIT 5').length > 2
        ? 1
        : 0
    ),
  'mint-diet-snack-log': (c) => {
    if (!c.exists(MINT)) return grade(0)
    const entries = c.all(
      MINT,
      "SELECT e.*,l.total_calories_kcal FROM food_entry e JOIN daily_log l ON l.id=e.daily_log_id WHERE l.log_date=? AND (lower(e.food_name)='banana' OR e.food_name='香蕉')",
      '2026-05-06'
    )
    let score = entries.length ? 0.4 : 0
    if (entries.some((r) => r.meal_slot === 'snacks')) score += 0.3
    if (entries.some((r) => close(r.quantity_value, 120, 0.05) && r.quantity_unit === 'g')) score += 0.2
    if (entries.some((r) => close(r.total_calories_kcal, 107, 0.05))) score += 0.1
    return grade(round(score, 2))
  },
  'mint-diet-stockout': (c) => {
    let score = 0
    for (const r of c.all(
      MINT,
      'SELECT id,food_catalog_id,food_name FROM food_entry ORDER BY id DESC LIMIT 5'
    ))
      if (r.food_name) {
        score = Math.max(score, 0.3)
        if (r.food_catalog_id && c.one(MINT, 'SELECT 1 FROM food_catalog WHERE id = ?', r.food_catalog_id))
          return grade(1)
      }
    return grade(score)
  },
  'nutrition-log-meal': (c) => {
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
      const base =
        "SELECT fe.id FROM food_entry fe JOIN daily_log dl ON fe.daily_log_id=dl.id WHERE dl.log_date=? AND fe.meal_slot='lunch' AND fe.quantity_value>0 AND "
      return grade(
        (c.one(MINT, base + "(fe.food_name COLLATE NOCASE = 'milk' OR fe.food_name = '牛奶')", today)
          ? 0.5
          : 0) + (c.one(MINT, base + "fe.food_name COLLATE NOCASE LIKE '%chicken salad%'", today) ? 0.5 : 0)
      )
    } catch {
      return grade(0)
    }
  },
  'mint-diet-comprehensive': (c) => {
    if (!c.exists(MINT)) return grade(0)
    try {
      const today = date(c.now()),
        monday = new Date(today + 'T00:00:00Z')
      monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7))
      const next = date(monday),
        tue = date(new Date(monday.getTime() + 86400000)),
        sun = date(new Date(monday.getTime() + 6 * 86400000))
      const log = c.one(MINT, 'SELECT id FROM daily_log WHERE log_date = ?', today)
      const entries = log ? c.all(MINT, 'SELECT * FROM food_entry WHERE daily_log_id = ?', log.id) : []
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
      const plan = c.one(MINT, "SELECT * FROM meal_plan WHERE title = 'Clean Eating Week'")
      let planScore = 0
      if (plan) {
        if (plan.status === 'active') planScore += 0.1
        if (plan.start_date === next && plan.end_date === sun) planScore += 0.05
        if (lower(plan.notes).includes('lean protein')) planScore += 0.05
        if (plan.target_calories_kcal === 1800) planScore += 0.05
      }
      const items = (day: string) =>
        plan
          ? c.all(
              MINT,
              'SELECT mpi.id,mpi.meal_slot,mpi.dish_name FROM meal_plan_item mpi JOIN meal_plan_day mpd ON mpd.id=mpi.meal_plan_day_id WHERE mpd.meal_plan_id=? AND mpd.plan_date=?',
              plan.id,
              day
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
  },
  'insurance-deductible-selection': (c) => {
    const p = c.one(
      INSURANCE,
      "SELECT ip.code,ip.name FROM current_policy cp JOIN insurance_plan ip ON cp.plan_id=ip.id WHERE cp.user_id=1 AND cp.status='active'"
    )
    if (p?.code !== 'B' || p.name !== 'Balanced Silver') return grade(0)
    const s = c.one(
      INSURANCE,
      'SELECT plan_code_snapshot,plan_name_snapshot FROM plan_selection WHERE user_id=1 ORDER BY id DESC LIMIT 1'
    )
    return grade(s?.plan_code_snapshot === 'B' && s.plan_name_snapshot === 'Balanced Silver' ? 1 : 0)
  },
  'health-insurance-optimization': (c) => {
    let score = 0
    const claim = c.one(
      INSURANCE,
      "SELECT notes FROM claim WHERE user_id=1 AND total_amount=25000 AND claim_type='reimbursement' AND provider_name='Metro Lab Services' AND check_item='lab' AND service_date='2026-05-10' ORDER BY id DESC LIMIT 1"
    )
    if (claim && lower(claim.notes).includes('blood work follow-up')) score += 0.25
    for (const [name, cost] of [
      ['Blood Test', 2500],
      ['Diet Consultation', 5000],
    ] as const)
      if (
        c.scalar(
          INSURANCE,
          'SELECT cost_snapshot FROM appointment WHERE user_id=1 AND service_name_snapshot=? ORDER BY id DESC LIMIT 1',
          name
        ) === cost
      )
        score += 0.25
    const appointments = c.all(
      INSURANCE,
      "SELECT service_name_snapshot,slot_start_time,slot_end_time FROM appointment WHERE user_id=1 AND service_name_snapshot IN ('Blood Test','Diet Consultation') ORDER BY id"
    )
    if (appointments.length < 2) return grade(score)
    const expected = new Map(appointments.map((a) => [a.service_name_snapshot, a]))
    const all = c.all(
      GWS,
      "SELECT summary,startDateTime,endDateTime FROM Event WHERE calendarId='integ@example.com' AND status!='cancelled' ORDER BY startDateTime"
    )
    const matches = [...expected]
      .map(([name, a]) =>
        all.find(
          (e) =>
            lower(e.summary).includes(lower(name)) &&
            iso(e.startDateTime) === iso(a.slot_start_time) &&
            iso(e.endDateTime) === iso(a.slot_end_time)
        )
      )
      .filter((e) => e !== undefined)
    if (all.length >= 2 && matches.length >= 2) {
      const [a, b] = matches
      const s1 = iso(a!.startDateTime),
        e1 = iso(a!.endDateTime),
        s2 = iso(b!.startDateTime),
        e2 = iso(b!.endDateTime)
      if (s1 !== null && s2 !== null && e1 !== null && e2 !== null && (e1 <= s2 || e2 <= s1)) score += 0.25
    }
    return grade(score)
  },
}
