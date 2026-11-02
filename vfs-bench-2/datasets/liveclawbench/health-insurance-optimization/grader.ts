import { type Grader, eq, ne, orderBy, GWS, grade, lower } from '../../../workspace/grader.ts'
import { iso } from '../graders/calendar.ts'
import { INSURANCE } from '../graders/health.ts'
export const grader: Grader = (c) => {
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
  }
