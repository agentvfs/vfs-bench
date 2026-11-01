/**
 * gaia2-cli's `calendar` app (apps/calendar.py), each command statement for
 * statement over the run's state. Times are UTC, as upstream's
 * `timezone.utc` makes them.
 */
import { typeName } from '../gaia2/pyrepr.ts'
import { PyDateTime, strptime } from '../gaia2/pytime.ts'
import {
  CliError,
  PyError,
  PyFloat,
  UsageError,
  get,
  jsonLoads,
  num,
  slice,
  str,
  truthy,
  valueError,
  type Call,
  type Command,
  type Py,
  type PyDict,
} from '../gaia2/store.ts'

const APP_NAME = 'Calendar'
export { APP_NAME }

const DATETIME_FORMAT = '%Y-%m-%d %H:%M:%S'
const DISPLAY_FORMAT = '%A, %Y-%m-%d %H:%M:%S'
const DEFAULT_DURATION_HOURS = 1

const typeError = (message: string) => new PyError('TypeError', message)
const attributeError = (v: unknown, attr: string) => new PyError('AttributeError', `'${typeName(v)}' object has no attribute '${attr}'`)

/** `a < b` or `a > b` for a stored value against a float. */
function compare(a: Py | undefined, op: '<' | '>', b: number | PyFloat): boolean {
  if (typeof a === 'number' || typeof a === 'boolean' || a instanceof PyFloat) {
    const x = Number(num(a))
    return op === '<' ? x < num(b) : x > num(b)
  }
  throw typeError(`'${op}' not supported between instances of '${typeName(a)}' and 'float'`)
}

/** `v.lower()`. */
function lower(v: Py | undefined): string {
  if (typeof v !== 'string') throw attributeError(v, 'lower')
  return v.toLowerCase()
}

/** `iter(v)`. */
function iterate(v: Py | undefined): Py[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return [...v]
  if (v !== null && typeof v === 'object' && !(v instanceof PyFloat)) return Object.keys(v)
  throw typeError(`'${typeName(v)}' object is not iterable`)
}

/** `item in container`, for a string item. */
function contains(container: Py | undefined, item: string): boolean {
  if (Array.isArray(container)) return container.some((x) => x === item)
  if (typeof container === 'string') return container.includes(item)
  if (container !== null && typeof container === 'object' && !(container instanceof PyFloat)) return Object.hasOwn(container, item)
  throw typeError(`argument of type '${typeName(container)}' is not iterable`)
}

/** A `required=True` option: click's usage error where it is missing. */
function need(c: Call, name: string): string {
  const v = c.str(name)
  if (v === null) throw new UsageError(`Missing option '--${name.replace(/_/g, '-')}'.`)
  return v
}

/** `_load_state`. */
function loaded(state: PyDict): PyDict {
  if (!truthy(state)) return { events: {} }
  if (!Object.hasOwn(state, 'events')) state.events = {}
  return state
}

const eventsOf = (state: PyDict) => state.events as Record<string, PyDict>

/** `_parse_datetime`. */
function parseDatetime(text: string): number | PyFloat {
  try {
    return strptime(text, DATETIME_FORMAT).timestamp()
  } catch (error) {
    if (error instanceof PyError && error.type === 'ValueError') throw valueError('Invalid datetime format. Please use YYYY-MM-DD HH:MM:SS')
    throw error
  }
}

/** `_strftime`. */
const strftime = (ts: number | PyFloat) => PyDateTime.fromtimestamp(num(ts)).strftime(DISPLAY_FORMAT)

/** `_event_dict`. */
function eventDict(eventId: string, event: PyDict): PyDict {
  return {
    event_id: eventId,
    title: get(event, 'title', ''),
    start_datetime: get(event, 'start_datetime', new PyFloat(0)),
    end_datetime: get(event, 'end_datetime', new PyFloat(0)),
    tag: get(event, 'tag'),
    description: get(event, 'description'),
    location: get(event, 'location'),
    attendees: get(event, 'attendees', []),
    start_strftime: get(event, 'start_strftime', ''),
    end_strftime: get(event, 'end_strftime', ''),
  }
}

/** The `--attendees` JSON, `[]` where it is missing or not JSON. */
function attendeesOf(c: Call): Py {
  const raw = c.str('attendees')
  if (raw === null) return []
  try {
    return jsonLoads(raw)
  } catch (error) {
    if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return []
    throw error
  }
}

/** The start and end, defaulting to now and an hour on, and their timestamps. */
function times(c: Call): { start: string; end: string; startTs: number | PyFloat; endTs: number | PyFloat } {
  let start = c.str('start_datetime')
  let end = c.str('end_datetime')
  const now = num(c.now())
  if (start === null) start = PyDateTime.fromtimestamp(now).strftime(DATETIME_FORMAT)
  if (end === null) end = PyDateTime.fromtimestamp(now).plus(DEFAULT_DURATION_HOURS * 3600).strftime(DATETIME_FORMAT)
  let startTs: number | PyFloat
  let endTs: number | PyFloat
  try {
    startTs = parseDatetime(start)
    endTs = parseDatetime(end)
  } catch (error) {
    throw new CliError(str(error))
  }
  if (num(startTs) > num(endTs)) throw new CliError('Start time cannot be after end time.')
  return { start, end, startTs, endTs }
}

/** The events overlapping `[fromTs, toTs]`, as `_event_dict`s. */
function overlapping(events: Record<string, PyDict>, fromTs: number | PyFloat, toTs: number | PyFloat): PyDict[] {
  const out: PyDict[] = []
  for (const [eid, ev] of Object.entries(events)) {
    if (compare(get(ev, 'start_datetime', 0), '<', toTs) && compare(get(ev, 'end_datetime', 0), '>', fromTs)) out.push(eventDict(eid, ev))
  }
  return out
}

export function commands(): Command[] {
  return [
    {
      name: 'add-event',
      async run(c) {
        const title = c.str('title', 'Event')!
        const tag = c.str('tag')
        const description = c.str('description')
        const location = c.str('location')
        const attendees = attendeesOf(c)
        const { start, end, startTs, endTs } = times(c)
        const state = loaded(await c.state())
        const events = eventsOf(state)
        const eventId = c.uuidHex()
        events[eventId] = {
          event_id: eventId,
          title,
          start_datetime: startTs,
          end_datetime: endTs,
          tag,
          description,
          location,
          attendees,
          start_strftime: strftime(startTs),
          end_strftime: strftime(endTs),
        }
        state.events = events
        await c.save(state)
        const args = { title, start_datetime: start, end_datetime: end, tag, description, location, attendees }
        await c.log('add_calendar_event', args, eventId, true)
        return { status: 'success', event_id: eventId }
      },
    },
    {
      name: 'get-event',
      async run(c) {
        const eventId = need(c, 'event_id')
        const events = eventsOf(loaded(await c.state()))
        if (!Object.hasOwn(events, eventId)) throw new CliError(`Calendar Event with id ${eventId} does not exist.`)
        const result = eventDict(eventId, events[eventId]!)
        await c.log('get_calendar_event', { event_id: eventId }, result)
        return result
      },
    },
    {
      name: 'delete-event',
      async run(c) {
        const eventId = need(c, 'event_id')
        const state = loaded(await c.state())
        const events = eventsOf(state)
        if (!Object.hasOwn(events, eventId)) throw new CliError(`Calendar Event with id ${eventId} does not exist.`)
        delete events[eventId]
        state.events = events
        await c.save(state)
        const result = `Event ${eventId} successfully deleted.`
        await c.log('delete_calendar_event', { event_id: eventId }, result, true)
        return { status: 'success', message: result }
      },
    },
    {
      name: 'get-events',
      async run(c) {
        const startDatetime = need(c, 'start_date')
        const endDatetime = need(c, 'end_date')
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 10)!
        let startTs: number | PyFloat
        let endTs: number | PyFloat
        try {
          startTs = parseDatetime(startDatetime)
          endTs = parseDatetime(endDatetime)
        } catch (error) {
          throw new CliError(str(error))
        }
        if (num(startTs) > num(endTs)) throw new CliError('Start time cannot be after end time.')
        const events = eventsOf(loaded(await c.state()))
        const found = overlapping(events, startTs, endTs)
        const startIndex = offset
        const endIndex = offset + limit
        const result = {
          events: slice(found, startIndex, endIndex),
          range: [startIndex, Math.min(endIndex, found.length)],
          total: found.length,
        }
        const args = { start_datetime: startDatetime, end_datetime: endDatetime, offset, limit }
        await c.log('get_calendar_events_from_to', args, result)
        return result
      },
    },
    {
      name: 'today-events',
      async run(c) {
        const today = PyDateTime.fromtimestamp(num(c.now())).midnight()
        const tomorrow = today.plus(86400)
        const todayTs = today.timestamp()
        const tomorrowTs = tomorrow.timestamp()
        const events = eventsOf(loaded(await c.state()))
        const found = overlapping(events, todayTs, tomorrowTs)
        const result = { events: found, range: [0, found.length], total: found.length }
        await c.log('read_today_calendar_events', {}, result)
        return result
      },
    },
    {
      name: 'get-all-tags',
      async run(c) {
        const events = eventsOf(loaded(await c.state()))
        // A set: upstream's order is its string hashes', here the order first seen.
        const seen = new Set<string>()
        const tags: Py[] = []
        for (const ev of Object.values(events)) {
          const tag = get(ev, 'tag')
          if (!truthy(tag)) continue
          if (typeof tag === 'object' && !(tag instanceof PyFloat)) throw typeError(`unhashable type: '${typeName(tag)}'`)
          const key = typeof tag === 'string' ? `s:${tag}` : `n:${Number(num(tag))}`
          if (seen.has(key)) continue
          seen.add(key)
          tags.push(tag)
        }
        await c.log('get_all_tags', {}, tags)
        return tags
      },
    },
    {
      name: 'get-events-by-tag',
      async run(c) {
        const tag = need(c, 'tag')
        if (!tag) throw new CliError('Tag cannot be empty.')
        const events = eventsOf(loaded(await c.state()))
        const results = Object.entries(events)
          .filter(([, ev]) => get(ev, 'tag') === tag)
          .map(([eid, ev]) => eventDict(eid, ev))
        await c.log('get_calendar_events_by_tag', { tag }, results)
        return results
      },
    },
    {
      name: 'search-events',
      async run(c) {
        const query = need(c, 'query')
        const events = eventsOf(loaded(await c.state()))
        const q = query.toLowerCase()
        const results: PyDict[] = []
        for (const [eid, ev] of Object.entries(events)) {
          const title = get(ev, 'title')
          if (
            lower(truthy(title) ? title : '').includes(q) ||
            (truthy(get(ev, 'description')) && lower(ev.description).includes(q)) ||
            (truthy(get(ev, 'location')) && lower(ev.location).includes(q)) ||
            iterate(get(ev, 'attendees', [])).some((att) => lower(att).includes(q))
          ) {
            results.push(eventDict(eid, ev))
          }
        }
        await c.log('search_events', { query }, results)
        return results
      },
    },
    {
      name: 'add-calendar-event-by-attendee',
      async run(c) {
        const whoAdd = need(c, 'who_add')
        let title = c.str('title', 'Event')!
        const tag = c.str('tag')
        let description = c.str('description')
        const location = c.str('location')
        const attendees = attendeesOf(c)
        const { start, end, startTs, endTs } = times(c)
        // Mimic Gaia2 app: auto-add who_add, prefix title/description
        if (!contains(attendees, whoAdd)) {
          if (!Array.isArray(attendees)) throw attributeError(attendees, 'append')
          attendees.push(whoAdd)
        }
        title = `Event created by ${whoAdd}: ${title}`
        description = description ? `Event created by ${whoAdd}: ${description}` : `Event created by ${whoAdd}`
        const state = loaded(await c.state())
        const events = eventsOf(state)
        const eventId = c.uuidHex()
        events[eventId] = {
          event_id: eventId,
          title,
          start_datetime: startTs,
          end_datetime: endTs,
          tag,
          description,
          location,
          attendees,
          start_strftime: strftime(startTs),
          end_strftime: strftime(endTs),
        }
        state.events = events
        await c.save(state)
        const args = { who_add: whoAdd, title, start_datetime: start, end_datetime: end, tag, description, location, attendees }
        await c.log('add_calendar_event_by_attendee', args, eventId, true)
        return { status: 'success', event_id: eventId }
      },
    },
    {
      name: 'delete-calendar-event-by-attendee',
      async run(c) {
        const eventId = need(c, 'event_id')
        const whoDelete = need(c, 'who_delete')
        const state = loaded(await c.state())
        const events = eventsOf(state)
        if (!Object.hasOwn(events, eventId)) throw new CliError(`Calendar Event with id ${eventId} does not exist.`)
        const ev = events[eventId]!
        if (!contains(get(ev, 'attendees', []), whoDelete)) throw new CliError(`${whoDelete} is not an attendee of the event.`)
        delete events[eventId]
        state.events = events
        await c.save(state)
        const result = `Event ${eventId} successfully deleted by ${whoDelete}.`
        await c.log('delete_calendar_event_by_attendee', { event_id: eventId, who_delete: whoDelete }, result, true)
        return { status: 'success', message: result }
      },
    },
  ]
}
