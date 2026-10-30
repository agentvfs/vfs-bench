import {
  eq,
  ne,
  gt,
  ge,
  le,
  like,
  asciiLower,
  orderBy,
  type Grader,
  type Context,
  type Row,
  GWS,
  grade,
  lower,
  round,
} from './context.ts'
import DATA from './reference-data.json' with { type: 'json' }
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
export const HEALTH_GRADERS: Record<string, Grader> = {
  'health-daily-record': daily,
  'health-record-verify': (c) =>
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
    ),
  'mint-diet-snack-log': (c) => {
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
  },
  'mint-diet-stockout': (c) => {
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
  },
  'insurance-deductible-selection': (c) => {
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
  },
  'health-insurance-optimization': (c) => {
    let score = 0
    const claim = c
      .rows(INSURANCE, 'claim')
      .filter(
        (r) =>
          eq(r.user_id, 1) &&
          eq(r.total_amount, 25000) &&
          eq(r.claim_type, 'reimbursement') &&
          eq(r.provider_name, 'Metro Lab Services') &&
          eq(r.check_item, 'lab') &&
          eq(r.service_date, '2026-05-10')
      )
      .sort(orderBy(['id', -1]))
      .slice(0, 1)[0]
    if (claim && lower(claim.notes).includes('blood work follow-up')) score += 0.25
    for (const [name, cost] of [
      ['Blood Test', 2500],
      ['Diet Consultation', 5000],
    ] as const)
      if (
        c
          .rows(INSURANCE, 'appointment')
          .filter((r) => eq(r.user_id, 1) && eq(r.service_name_snapshot, name))
          .sort(orderBy(['id', -1]))
          .slice(0, 1)[0]?.cost_snapshot === cost
      )
        score += 0.25
    const appointments = c
      .rows(INSURANCE, 'appointment')
      .filter(
        (r) =>
          eq(r.user_id, 1) && ['Blood Test', 'Diet Consultation'].some((v) => eq(r.service_name_snapshot, v))
      )
      .sort(orderBy(['id', 1]))
    if (appointments.length < 2) return grade(score)
    const expected = new Map(appointments.map((a) => [a.service_name_snapshot, a]))
    const all = c
      .rows(GWS, 'Event')
      .filter((r) => eq(r.calendarId, 'integ@example.com') && ne(r.status, 'cancelled'))
      .sort(orderBy(['startDateTime', 1]))
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
