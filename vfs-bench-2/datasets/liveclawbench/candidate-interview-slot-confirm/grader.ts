import { type Grader, GWS, containsAny, grade, lower, round } from '../../../workspace/grader.ts'
import { iso, events, confirmation } from '../graders/calendar.ts'
export const grader: Grader = (c) => {
    if (!c.exists(GWS)) return grade(0)
    const event = events(c).find(
      (e) => e.start === iso('2026-05-26T14:00:00') && e.end === iso('2026-05-26T15:00:00')
    )
    const cal = event
      ? containsAny(lower(event.summary), ['interview', 'candidate', 'alex', 'developer'])
        ? 0.5
        : 0.35
      : 0
    return grade(round(cal + confirmation(c, false), 2))
  }
