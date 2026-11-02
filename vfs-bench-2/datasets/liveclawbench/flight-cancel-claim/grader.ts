import { type Grader, eq, GWS, grade, lower, mails } from '../../../workspace/grader.ts'
import { DB, EMAIL, selected } from '../graders/airline.ts'
export const grader: Grader = (c) => {
    const state = selected(c)
    if (!state || !c.exists(GWS)) return grade(0)
    const user = c.rows(DB, 'users').filter((r) => eq(r.email, EMAIL))[0]!,
      m = mails(c).find((m) => m.to.includes('claims@gkdairlines.com'))
    if (!m) return grade(0)
    const text = lower(m.subject + ' ' + m.body),
      f = state.flight,
      dep = f.departure_time ?? '',
      day = dep.slice(0, 10)
    let monthDate = ''
    const match = dep.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) {
      const month = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
      ][Number(match[2]) - 1]
      if (month) monthDate = `${month} ${match[3]}, ${match[1]}`
    }
    const checks = [
      text.includes(lower(f.flight_number)),
      Boolean((day && text.includes(day)) || (monthDate && text.includes(monthDate))),
      text.includes(lower(f.origin_city)),
      text.includes(lower(f.destination_city)),
      text.includes(lower(state.booking.booking_reference)),
      text.includes('peter griffin'),
      text.includes(lower(user.email)),
      Boolean(user.phone && text.includes(user.phone)),
      c.rows(GWS, 'Attachment').filter((r) => eq(r.messageId, m.id)).length > 0,
    ]
    return grade(checks.filter(Boolean).length / 9)
  }
