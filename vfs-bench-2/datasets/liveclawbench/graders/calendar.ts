import { ne, orderBy, type Context, type Row, GWS, containsAny, lower, mails } from '../../../workspace/grader.ts'
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
export function confirmation(c: Context, reschedule: boolean): number {
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
