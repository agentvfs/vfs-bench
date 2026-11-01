import { type Grader, ne, orderBy, type Row, GWS, grade, lower } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    let score = 0
    for (const e of c
      .rows(GWS, 'Event')
      .filter((e) => ne(e.status, 'cancelled'))
      .sort(orderBy(['seq', -1]))
      .map((e): Row => ({ ...e, start: e.startDateTime ?? e.startDate, end: e.endDateTime ?? e.endDate }))) {
      if (lower(e.summary) !== 'team standup')
        score = Math.max(score, e.start && e.end ? 1 : e.start || e.end ? 0.3 : 0)
    }
    return grade(score)
  }
