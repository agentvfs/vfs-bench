import {
  eq,
  ne,
  like,
  orderBy,
  type Context,
  type Grader,
  type Row,
  GWS,
  containsAny,
  grade,
  lower,
  mails,
  round,
} from '../../../workspace/grader.ts'

/** Python naive times default to UTC; explicit IANA zones use their offset. */
export function iso(value: any, zone?: string | null): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let s = value.trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return null
  const aware = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)
  const [year, month, day] = s.slice(0, 10).split('-').map(Number)
  const days = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  if (year! < 1 || month! < 1 || month! > 12 || day! < 1 || day! > days) return null
  if (!s.includes('T')) s += 'T00:00:00'
  let time = Date.parse(s + (aware ? '' : 'Z'))
  if (!Number.isFinite(time)) return null
  const fraction = s.match(/\.(\d+)/)?.[1]
  const micros = fraction ? Number('0.' + fraction.slice(0, 6).padEnd(6, '0')) * 1000 : 0
  const subMillisecond = micros - Math.floor(micros)
  if (!aware && zone && !['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Z'].includes(zone)) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
      const wall = time
      const offsetAt = (instant: number) => {
        const p = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]))
        const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
        return shown - Math.floor(instant / 1000) * 1000
      }
      const before = offsetAt(wall - 36 * 3600000),
        after = offsetAt(wall + 36 * 3600000)
      const candidates = [...new Set([before, after])].map((offset) => wall - offset)
      const valid = candidates.filter((candidate) => candidate + offsetAt(candidate) === wall)
      // ZoneInfo defaults to fold=0: first occurrence in an overlap,
      // and the pre-transition offset for a nonexistent local time.
      time = valid.length ? Math.min(...valid) : wall - before
    } catch {
      return null
    }
  }
  return time + subMillisecond
}
export function events(c: Context, primary = true): (Row & { start: number | null; end: number | null })[] {
  return c
    .rows(GWS, 'Event')
    .filter((e) => (!primary || e.calendarId === 'integ@example.com') && ne(e.status, 'cancelled'))
    .sort(orderBy(['seq', 1]))
    .map((e) => ({
      ...e,
      start: iso(e.startDateTime, e.startTimeZone),
      end: iso(e.endDateTime, e.endTimeZone),
    }))
}
function confirmation(c: Context, reschedule: boolean): number {
  const m = mails(c)
    .reverse()
    .find((m) => m.to.includes('hr@work.mosi.inc'))
  if (!m) return 0
  const subject = lower(m.subject),
    body = lower(m.body),
    word = reschedule ? 'reschedule' : 'interview'
  const intent = subject.includes(word) || body.includes(word) || subject.includes('confirm')
  const date = containsAny(
    body,
    reschedule ? ['may 23', '10:00', 'saturday'] : ['may 26', '2:00', 'tuesday', '3:00']
  )
  return intent && date ? (reschedule ? 0.33 : 0.5) : intent || date ? (reschedule ? 0.15 : 0.25) : 0
}
export const CALENDAR_GRADERS: Record<string, Grader> = {
  'candidate-interview-slot-confirm': (c) => {
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
  },
  'meeting-reschedule-response': (c) => {
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
  },
  'interview-slot-verify': (c) => {
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
  },
}
