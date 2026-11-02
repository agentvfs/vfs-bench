import { type Grader, eq, like, orderBy, GWS, containsAny, grade, lower } from '../../../workspace/grader.ts'
import { iso, events } from '../graders/calendar.ts'
export const grader: Grader = (c) => {
    let start = iso('2026-05-26T14:00:00'),
      end = iso('2026-05-26T15:00:00')
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
          start = iso(`${date}T${hour(t[1]!, t[3]!)}:${t[2]}:00`)
          end = iso(`${date}T${hour(t[4]!, t[6]!)}:${t[5]}:00`)
        }
      }
    }
    let score = 0
    for (const e of events(c, false)) {
      // This reference formats event times to whole seconds before comparing.
      if (
        e.start !== null &&
        e.end !== null &&
        start !== null &&
        end !== null &&
        Math.floor(e.start / 1000) === start / 1000 &&
        Math.floor(e.end / 1000) === end / 1000
      )
        return grade(1)
      if (containsAny(lower(e.summary), ['interview', 'thompson'])) score = Math.max(score, 0.3)
    }
    return grade(score)
  }
