import { type Grader, GWS, grade, round } from '../../../workspace/grader.ts'
import { iso, events, confirmation } from '../graders/calendar.ts'
export const grader: Grader = (c) => {
    if (!c.exists(GWS)) return grade(0)
    const all = events(c),
      exists = (a: string, b: string) => all.some((e) => e.start === iso(a) && e.end === iso(b))
    return grade(
      round(
        (exists('2026-05-22T14:00:00', '2026-05-22T15:00:00') ? 0 : 0.33) +
          (exists('2026-05-23T10:00:00', '2026-05-23T11:00:00') ? 0.34 : 0) +
          confirmation(c, true),
        2
      )
    )
  }
