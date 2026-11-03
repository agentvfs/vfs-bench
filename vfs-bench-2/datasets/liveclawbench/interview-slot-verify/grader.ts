import { type Grader, eq, like, orderBy, GWS, containsAny, grade, lower } from '../../../workspace/grader.ts'
import { events } from '../graders/calendar.ts'
export const grader: Grader = (c) => {
    // Upstream's FALLBACK_START and FALLBACK_END, and the strings it parses
    // from the email: `YYYY-MM-DD HH:MM:SS`.
    let start = '2026-05-26 14:00:00',
      end = '2026-05-26 15:00:00'
    const body = c
      .rows(GWS, 'Message')
      .sort(orderBy(['seq', 1]))
      .find((m) =>
        c
          .rows(GWS, 'MessageHeader')
          .some(
            (h) =>
              eq(h.tenant, m.tenant) &&
              eq(h.messageId, m.id) &&
              h.name === 'Subject' &&
              like(h.value, '%Interview Confirmation%')
          )
      )?.bodyText
    if (typeof body === 'string') {
      const d = body.match(/Date:\s*\w+,\s*(\w+)\s+(\d+),\s*(\d+)/),
        t = body.match(/Time:\s*(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/)
      if (d && t) {
        const month =
          [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
          ].findIndex((m) => lower(m) === lower(d[1])) + 1
        if (month) {
          const date = `${d[3]}-${String(month).padStart(2, '0')}-${d[2]!.padStart(2, '0')}`
          const hour = (h: string, ap: string) =>
            String(Number(h) + (ap === 'PM' && Number(h) !== 12 ? 12 : 0)).padStart(2, '0')
          start = `${date} ${hour(t[1]!, t[3]!)}:${t[2]}:00`
          end = `${date} ${hour(t[4]!, t[6]!)}:${t[5]}:00`
        }
      }
    }
    let score = 0
    for (const e of events(c, false)) {
      // Upstream's `start == correct_start`: the stored strings as they are.
      // Its mock stores `toISOString()` and Calendar RFC 3339, neither of
      // which is ever `YYYY-MM-DD HH:MM:SS`, so 1.0 is upstream's slip.
      if (e.startDateTime === start && e.endDateTime === end) return grade(1)
      if (containsAny(lower(e.summary), ['interview', 'thompson'])) score = Math.max(score, 0.3)
    }
    return grade(score)
  }
