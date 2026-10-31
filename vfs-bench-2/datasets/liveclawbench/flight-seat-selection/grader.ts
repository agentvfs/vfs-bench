import { type Grader, eq, grade } from '../../../workspace/grader.ts'
import { DB, selected } from '../graders/airline.ts'
export const grader: Grader = (c) => {
    const state = selected(c)
    if (!state?.passenger) return grade(0)
    const seat = state.passenger.seat_id
      ? c.rows(DB, 'seats').filter((r) => eq(r.id, state.passenger.seat_id))[0]
      : undefined
    let score = 0
    if (seat) {
      score += 0.4
      if (/[AF]/.test(String(seat.seat_number ?? '').toUpperCase())) score += 0.3
    }
    if (state.booking.checked_in) score += 0.3
    return grade(Math.min(score, 1))
  }
