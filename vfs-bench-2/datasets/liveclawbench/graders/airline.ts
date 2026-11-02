import { instantDate, eq, type Context, type Grader, grade, lower, strip } from '../../../workspace/grader.ts'
export const DB = '/var/lib/mock-data/airline/airline.db',
  EMAIL = 'peter.griffin@work.mosi.inc'
export const SESSION = '/logs/agent/openclaw-state/agents/main/sessions/harbor.jsonl'
export function harborLastMessage(c: Context): string | null {
  let data: any
  try {
    data = c.json('/logs/agent/trajectory.json')
  } catch {
    return null
  }
  for (const step of [...(data.steps ?? [])].reverse()) {
    let message = step.message
    if (Array.isArray(message))
      message = message
        .filter((p) => p && typeof p === 'object' && p.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n')
    if (step.source === 'agent' && typeof message === 'string' && strip(message)) return message
  }
  return null
}
export const booking: Grader = (c) => {
  if (!c.exists(DB)) return grade(0)
  const user = c.rows(DB, 'users').filter((r) => eq(r.email, EMAIL))[0]
  if (!user) return grade(0)
  const next = c.now()
  next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7 || 7))
  const rows = c
    .rows(DB, 'bookings')
    .filter((b) => eq(b.user_id, user.id))
    .flatMap((b) =>
      c
        .rows(DB, 'flights')
        .filter(
          (f) =>
            eq(f.id, b.flight_id) &&
            f.origin_code === 'JFK' &&
            f.destination_code === 'LAX' &&
            instantDate(f.departure_time) === next.toISOString().slice(0, 10)
        )
        .map((f) => ({ cabin_class: b.cabin_class, departure_time: f.departure_time }))
    )
  const target = rows.find((r) => lower(r.cabin_class) === 'economy')
  if (!target) return grade(0)
  return grade(/[T ]10:00(?:[:+Z-]|$)/.test(target.departure_time ?? '') ? 1 : 0.8)
}
export function selected(c: Context) {
  const user = c.rows(DB, 'users').filter((r) => eq(r.email, EMAIL))[0],
    flight = c.rows(DB, 'flights').filter((r) => eq(r.flight_number, 'GKD2001'))[0]
  if (!user || !flight) return null
  const booking = c
    .rows(DB, 'bookings')
    .filter((r) => eq(r.user_id, user.id) && eq(r.flight_id, flight.id))
    .slice(0, 1)[0]
  if (!booking) return null
  const passenger = c
    .rows(DB, 'passengers')
    .filter((r) => eq(r.booking_id, booking.id))
    .slice(0, 1)[0]
  return { user, flight, booking, passenger }
}
