// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

import { createHash } from "node:crypto";
import http from "node:http";
const BIND_HOST = process.env.MIRAGE_BIND_HOST ?? "127.0.0.1";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const SLIDE_MIME = "application/vnd.google-apps.presentation";
const FORM_MIME = "application/vnd.google-apps.form";
const OWNER = { displayName: "Integ User", emailAddress: "integ@example.com", me: true };
const GRID_ROWS = 1e3;
const GRID_COLUMNS = 26;
const ROW_PIXELS = 21;
const COLUMN_PIXELS = 100;
const SYSTEM_LABELS = ["INBOX", "SENT", "UNREAD", "TRASH"];
const DEFAULT_CALENDAR_TZ = "Asia/Hong_Kong";
const PRIMARY_CALENDAR_ID = "integ@example.com";
class GwsState {
  files = /* @__PURE__ */ new Map();
  drives = /* @__PURE__ */ new Map();
  docs = /* @__PURE__ */ new Map();
  sheets = /* @__PURE__ */ new Map();
  presentations = /* @__PURE__ */ new Map();
  messages = /* @__PURE__ */ new Map();
  labels = /* @__PURE__ */ new Map();
  calendars = /* @__PURE__ */ new Map();
  events = /* @__PURE__ */ new Map();
  forms = /* @__PURE__ */ new Map();
  counters = /* @__PURE__ */ new Map();
  ticks = 0;
  // Frozen at construction (i.e. per /reset) so find -mtime windows
  // relative to "now" behave like a live backend, while the +1s tick per
  // touch keeps ordering deterministic. /reset may pin an explicit epoch
  // instead: mounts that render timestamps into filenames (gdocs/gsheets/
  // gslides date prefixes, gmail date dirs) need fully baked-in listings.
  baseMs;
  constructor(epoch, calendarTz) {
    this.baseMs = epoch === void 0 ? Date.now() : Date.parse(epoch);
    for (const id of SYSTEM_LABELS) this.labels.set(id, { id, name: id, type: "system" });
    this.calendars.set(PRIMARY_CALENDAR_ID, {
      id: PRIMARY_CALENDAR_ID,
      summary: "Integ User",
      timeZone: calendarTz ?? DEFAULT_CALENDAR_TZ,
      accessRole: "owner",
      primary: true
    });
    this.events.set(PRIMARY_CALENDAR_ID, /* @__PURE__ */ new Map());
  }
  nextId(kind) {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    return `${kind}${String(n).padStart(4, "0")}`;
  }
  // Real Google event ids are 26 chars of base32hex (0-9a-v); filenames on a
  // gcal mount embed them, so the mock must produce the real shape, not a
  // short counter. Deterministic so integ truth files stay stable.
  nextEventId() {
    const n = (this.counters.get("event") ?? 0) + 1;
    this.counters.set("event", n);
    return `evt${String(n).padStart(23, "0")}`;
  }
  nowMs() {
    this.ticks += 1;
    return this.baseMs + this.ticks * 1e3;
  }
  now() {
    return new Date(this.nowMs()).toISOString();
  }
}
let state = new GwsState();
// Import a controller-verified Toolathlon capture. Subsequent reads and writes
// still use the original Google Workspace handlers and the trial's private state.
function restoreSheets(capture) {
  for (const file of capture.files) {
    const item = createDriveItem(file.name, file.mimeType, file.parents, Buffer.alloc(0), file.id);
    item.createdTime = file.createdTime;
    item.modifiedTime = file.modifiedTime;
    item.trashed = file.trashed;
    item.permissions = file.permissions;
  }
  for (const sheet of capture.spreadsheets) {
    state.sheets.set(sheet.id, {
      title: sheet.title,
      nextSheetId: sheet.nextSheetId,
      tabs: sheet.tabs.map((tab) => ({
        ...tab, cells: new Map(tab.cells),
      })),
    });
  }
  state.counters = new Map(capture.counters);
  state.ticks = capture.ticks;
}
function md5(data) {
  return createHash("md5").update(data).digest("hex");
}
function googleError(code, message, status) {
  return [code, { error: { code, message, status } }];
}
const NOT_FOUND = googleError(404, "File not found.", "NOT_FOUND");
function isNativeMime(mime) {
  return mime === DOC_MIME || mime === SHEET_MIME || mime === SLIDE_MIME;
}
function fmtFile(item) {
  const out = {
    kind: "drive#file",
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    parents: [...item.parents],
    trashed: item.trashed,
    createdTime: item.createdTime,
    modifiedTime: item.modifiedTime,
    owners: [OWNER],
    capabilities: { canEdit: true }
  };
  if (item.driveId !== void 0) out.driveId = item.driveId;
  if (!isNativeMime(item.mimeType) && item.mimeType !== FOLDER_MIME) {
    out.size = String(item.content.length);
    out.md5Checksum = md5(item.content);
  }
  if (item.revisions.length > 0) {
    out.headRevisionId = item.revisions[item.revisions.length - 1].id;
  }
  return out;
}
function pushRevision(item) {
  item.revisions.push({
    id: `${item.id}-r${String(item.revisions.length + 1)}`,
    modifiedTime: item.modifiedTime,
    md5Checksum: md5(item.content),
    content: Buffer.from(item.content)
  });
}
function createDriveItem(name, mimeType, parents, content = Buffer.alloc(0), id) {
  const item = {
    id: id ?? state.nextId("f"),
    name,
    mimeType,
    parents: parents.length > 0 ? parents : ["root"],
    trashed: false,
    createdTime: state.now(),
    modifiedTime: "",
    content,
    revisions: [],
    permissions: []
  };
  item.modifiedTime = item.createdTime;
  const parentDrive = state.files.get(item.parents[0] ?? "")?.driveId;
  if (parentDrive !== void 0) item.driveId = parentDrive;
  if (!isNativeMime(mimeType) && mimeType !== FOLDER_MIME) pushRevision(item);
  state.files.set(item.id, item);
  autoLink(item);
  return item;
}
function autoLink(item) {
  if (item.mimeType === DOC_MIME && !state.docs.has(item.id)) {
    state.docs.set(item.id, { title: item.name, text: "" });
  } else if (item.mimeType === SHEET_MIME && !state.sheets.has(item.id)) {
    state.sheets.set(item.id, {
      title: item.name,
      tabs: [newTab(0, "Sheet1")],
      nextSheetId: 1
    });
  } else if (item.mimeType === SLIDE_MIME && !state.presentations.has(item.id)) {
    state.presentations.set(item.id, {
      title: item.name,
      slides: [newSlide()]
    });
  }
}
function unlinkEntity(id) {
  state.docs.delete(id);
  state.sheets.delete(id);
  state.presentations.delete(id);
}
function parseDriveQuery(q) {
  const clauses = [];
  let depth = false;
  let current = "";
  const parts = [];
  for (let i = 0; i < q.length; i += 1) {
    const c = q[i];
    if (depth && c === "\\" && i + 1 < q.length) {
      current += c + q[i + 1];
      i += 1;
      continue;
    }
    if (c === "'") depth = !depth;
    if (!depth && q.slice(i, i + 5) === " and ") {
      parts.push(current);
      current = "";
      i += 4;
      continue;
    }
    current += c;
  }
  if (current.trim() !== "") parts.push(current);
  for (const raw of parts) {
    const part = raw.trim();
    let m = /^'((?:[^'\\]|\\.)*)'\s+in\s+parents$/.exec(part);
    if (m !== null) {
      clauses.push({ field: "parents", op: "in", value: unescapeQ(m[1]) });
      continue;
    }
    m = /^(\w+)\s*(=|!=|>=|<=|>|<|contains)\s*'((?:[^'\\]|\\.)*)'$/.exec(part);
    if (m !== null) {
      clauses.push({ field: m[1], op: m[2], value: unescapeQ(m[3]) });
      continue;
    }
    m = /^(\w+)\s*=\s*(true|false)$/.exec(part);
    if (m !== null) {
      clauses.push({ field: m[1], op: "=", value: m[2] });
      continue;
    }
    throw new Error(`unsupported query clause: ${part}`);
  }
  return clauses;
}
function unescapeQ(value) {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "\\" && i + 1 < value.length) {
      i += 1;
      out += value[i];
      continue;
    }
    out += value[i];
  }
  return out;
}
function fullTextOf(item) {
  const parts = [item.name];
  const doc = state.docs.get(item.id);
  if (doc !== void 0) parts.push(doc.text);
  const sheet = state.sheets.get(item.id);
  if (sheet !== void 0) {
    for (const tab of sheet.tabs) parts.push([...tab.cells.values()].join(" "));
  }
  if (item.content.length > 0) parts.push(item.content.toString("utf8"));
  return parts.join("\n");
}
function matchClause(item, clause) {
  switch (clause.field) {
    case "parents":
      return item.parents.includes(clause.value);
    case "name":
      if (clause.op === "contains") return item.name.includes(clause.value);
      if (clause.op === "!=") return item.name !== clause.value;
      return item.name === clause.value;
    case "mimeType":
      if (clause.op === "contains") return item.mimeType.includes(clause.value);
      if (clause.op === "!=") return item.mimeType !== clause.value;
      return item.mimeType === clause.value;
    case "fullText":
      if (clause.op !== "contains") {
        throw new Error(`unsupported operator for fullText: ${clause.op}`);
      }
      return fullTextOf(item).toLowerCase().includes(clause.value.toLowerCase());
    case "trashed":
      return item.trashed === (clause.value === "true");
    case "modifiedTime": {
      if (clause.op === ">=") return item.modifiedTime >= clause.value;
      if (clause.op === "<") return item.modifiedTime < clause.value;
      if (clause.op === ">") return item.modifiedTime > clause.value;
      if (clause.op === "<=") return item.modifiedTime <= clause.value;
      return item.modifiedTime === clause.value;
    }
    default:
      throw new Error(`unsupported query field: ${clause.field}`);
  }
}
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1e3;
function listFiles(query) {
  const q = query.get("q");
  let items = [...state.files.values()];
  const driveId = query.get("driveId");
  if (driveId !== null) {
    items = items.filter((item) => item.driveId === driveId);
  } else if (query.get("includeItemsFromAllDrives") !== "true") {
    items = items.filter((item) => item.driveId === void 0);
  }
  if (q !== null && q.trim() !== "") {
    try {
      const clauses = parseDriveQuery(q);
      items = items.filter((item) => clauses.every((c) => matchClause(item, c)));
    } catch (err) {
      return googleError(400, err instanceof Error ? err.message : String(err), "INVALID_ARGUMENT");
    }
  } else {
    items = items.filter((item) => !item.trashed);
  }
  if (query.get("orderBy") === "modifiedTime desc") {
    items.sort(
      (a, b) => a.modifiedTime === b.modifiedTime ? a.id.localeCompare(b.id) : b.modifiedTime.localeCompare(a.modifiedTime)
    );
  }
  const rawSize = query.get("pageSize");
  const parsedSize = rawSize === null ? DEFAULT_PAGE_SIZE : Number.parseInt(rawSize, 10);
  const pageSize = Number.isNaN(parsedSize) || parsedSize < 1 ? DEFAULT_PAGE_SIZE : Math.min(parsedSize, MAX_PAGE_SIZE);
  const rawToken = query.get("pageToken");
  const parsedStart = rawToken === null ? 0 : Number.parseInt(rawToken, 10);
  if (rawToken !== null && (Number.isNaN(parsedStart) || parsedStart < 0)) {
    return googleError(400, `Invalid page token: ${rawToken}`, "INVALID_ARGUMENT");
  }
  const start = rawToken === null ? 0 : parsedStart;
  const page = items.slice(start, start + pageSize);
  const body = {
    kind: "drive#fileList",
    incompleteSearch: false,
    files: page.map(fmtFile)
  };
  if (start + pageSize < items.length) {
    body.nextPageToken = String(start + pageSize);
  }
  return [200, body];
}
function deleteTree(id) {
  const doomed = [id];
  while (doomed.length > 0) {
    const current = doomed.pop();
    for (const item of state.files.values()) {
      if (item.parents.includes(current)) doomed.push(item.id);
    }
    state.files.delete(current);
    unlinkEntity(current);
  }
}
function exportFile(item, mimeType) {
  if (item.mimeType === DOC_MIME && mimeType === "text/plain") {
    const doc = state.docs.get(item.id);
    return [200, Buffer.from(doc?.text ?? ""), "text/plain"];
  }
  if (item.mimeType === SHEET_MIME && mimeType === "text/csv") {
    const sheet = state.sheets.get(item.id);
    const tab = sheet?.tabs[0];
    return [200, Buffer.from(tab === void 0 ? "" : tabToCsv(tab)), "text/csv"];
  }
  const [code, body] = googleError(400, `Export of ${item.mimeType} to ${mimeType} is not supported.`, "INVALID_ARGUMENT");
  return [code, body, "application/json"];
}
function buildDocBody(text) {
  const content = [
    {
      startIndex: 1,
      endIndex: 1,
      sectionBreak: {
        sectionStyle: {
          columnSeparatorStyle: "NONE",
          contentDirection: "LEFT_TO_RIGHT",
          sectionType: "CONTINUOUS"
        }
      }
    }
  ];
  const normalized = text + "\n";
  let cursor = 1;
  const paragraphs = normalized.split("\n");
  if (paragraphs[paragraphs.length - 1] === "") paragraphs.pop();
  for (const para of paragraphs) {
    const paraText = para + "\n";
    const startIndex = cursor;
    const endIndex = cursor + paraText.length;
    content.push({
      startIndex,
      endIndex,
      paragraph: {
        elements: [{ startIndex, endIndex, textRun: { content: paraText, textStyle: {} } }],
        paragraphStyle: { namedStyleType: "NORMAL_TEXT", direction: "LEFT_TO_RIGHT" }
      }
    });
    cursor = endIndex;
  }
  return { content };
}
function fmtDocument(id) {
  const doc = state.docs.get(id);
  const file = state.files.get(id);
  return {
    documentId: id,
    title: doc.title,
    body: buildDocBody(doc.text),
    revisionId: `rev-${String(file?.revisions.length ?? 0)}`
  };
}
function replaceAllText(haystack, needle, replacement, matchCase) {
  if (needle === "") return [haystack, 0];
  const find = matchCase ? needle : needle.toLowerCase();
  let out = "";
  let cursor = 0;
  let count = 0;
  while (cursor + needle.length <= haystack.length) {
    const window = haystack.slice(cursor, cursor + needle.length);
    if ((matchCase ? window : window.toLowerCase()) === find) {
      out += replacement;
      cursor += needle.length;
      count += 1;
    } else {
      out += haystack[cursor];
      cursor += 1;
    }
  }
  return [out + haystack.slice(cursor), count];
}
function docsBatchUpdate(id, requests) {
  const doc = state.docs.get(id);
  if (doc === void 0) return NOT_FOUND;
  const replies = [];
  for (const request of requests) {
    if ("insertText" in request) {
      const r = request.insertText;
      const text = r.text ?? "";
      if (r.location?.index !== void 0) {
        const offset = Math.max(0, Math.min(doc.text.length, r.location.index - 1));
        doc.text = doc.text.slice(0, offset) + text + doc.text.slice(offset);
      } else {
        doc.text += text;
      }
      replies.push({});
    } else if ("deleteContentRange" in request) {
      const r = request.deleteContentRange;
      const start = Math.max(0, (r.range?.startIndex ?? 1) - 1);
      const end = Math.max(start, (r.range?.endIndex ?? 1) - 1);
      doc.text = doc.text.slice(0, start) + doc.text.slice(end);
      replies.push({});
    } else if ("replaceAllText" in request) {
      const r = request.replaceAllText;
      const [text, occurrences] = replaceAllText(
        doc.text,
        r.containsText?.text ?? "",
        r.replaceText ?? "",
        r.containsText?.matchCase ?? false
      );
      doc.text = text;
      replies.push({ replaceAllText: { occurrencesChanged: occurrences } });
    } else {
      return googleError(400, `Unsupported request: ${Object.keys(request).join(",")}`, "INVALID_ARGUMENT");
    }
  }
  touchNative(id);
  return [200, { documentId: id, replies }];
}
function touchNative(id) {
  const file = state.files.get(id);
  if (file !== void 0) file.modifiedTime = state.now();
}
function newTab(sheetId, title, rows = GRID_ROWS, cols = GRID_COLUMNS) {
  return { sheetId, title, cells: /* @__PURE__ */ new Map(), rows, cols };
}
function colLetterToIndex(letters) {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}
function colIndexToLetter(col) {
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function parseCell(ref) {
  const m = /^([A-Z]*)(\d*)$/.exec(ref.toUpperCase());
  if (m === null) return { row: null, col: null };
  const col = m[1] !== "" ? colLetterToIndex(m[1]) : null;
  const row = m[2] !== "" ? parseInt(m[2], 10) - 1 : null;
  return { row, col };
}
const A1_ONLY = /^([A-Z]+\d*|\d+)(:([A-Z]+\d*|\d+))?$/i;
function splitRange(range) {
  if (range.startsWith("'")) {
    let at = 1;
    let name = "";
    while (at < range.length && range[at] !== "'") {
      name += range[at];
      at += 1;
    }
    while (range[at] === "'" && range[at + 1] === "'") {
      name += "'";
      at += 2;
      while (at < range.length && range[at] !== "'") {
        name += range[at];
        at += 1;
      }
    }
    if (at >= range.length) return null;
    const rest = range.slice(at + 1);
    if (rest === "") return { tabName: name, cells: "" };
    if (!rest.startsWith("!")) return null;
    return { tabName: name, cells: rest.slice(1) };
  }
  const bang = range.lastIndexOf("!");
  if (bang === -1) return null;
  return { tabName: range.slice(0, bang), cells: range.slice(bang + 1) };
}
function parseA1(sheet, range) {
  let tabName = "";
  let cells = range;
  const split = splitRange(range);
  if (split !== null) {
    tabName = split.tabName;
    cells = split.cells;
  } else if (
    // A bare range names a sheet tab first ("Sheet1" is a tab, not the
    // cell SHEET1), matching the real API's resolution order.
    sheet.tabs.some((t) => t.title === range) || !A1_ONLY.test(range)
  ) {
    tabName = range;
    cells = "";
  }
  const tab = tabName === "" ? sheet.tabs[0] : sheet.tabs.find((t) => t.title === tabName);
  if (tab === void 0) return null;
  if (cells === "") return { tab, startRow: 0, startCol: 0, endRow: null, endCol: null };
  const [startRef, endRef] = cells.split(":");
  const start = parseCell(startRef);
  const end = endRef !== void 0 ? parseCell(endRef) : start;
  return {
    tab,
    startRow: start.row ?? 0,
    startCol: start.col ?? 0,
    endRow: end.row,
    endCol: end.col
  };
}
function tabExtent(tab) {
  let rows = 0;
  let cols = 0;
  for (const key of tab.cells.keys()) {
    const [r, c] = key.split(",").map(Number);
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols };
}
function rangeValues(range) {
  const extent = tabExtent(range.tab);
  const endRow = Math.min(range.endRow ?? extent.rows - 1, extent.rows - 1);
  const endCol = range.endCol ?? extent.cols - 1;
  const out = [];
  for (let r = range.startRow; r <= endRow; r += 1) {
    const row = [];
    for (let c = range.startCol; c <= endCol; c += 1) {
      row.push(range.tab.cells.get(`${String(r)},${String(c)}`) ?? "");
    }
    while (row.length > 0 && row[row.length - 1] === "") row.pop();
    out.push(row);
  }
  while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
  return out;
}
function tabToCsv(tab) {
  const rows = rangeValues({ tab, startRow: 0, startCol: 0, endRow: null, endCol: null });
  return rows.map((r) => r.join(",")).join("\n") + (rows.length > 0 ? "\n" : "");
}
function writeValues(range, values, startRow) {
  let cells = 0;
  for (let i = 0; i < values.length; i += 1) {
    const row = values[i];
    for (let j = 0; j < row.length; j += 1) {
      range.tab.cells.set(`${String(startRow + i)},${String(range.startCol + j)}`, String(row[j]));
      cells += 1;
    }
  }
  return cells;
}
function clearRange(range) {
  const extent = tabExtent(range.tab);
  const endRow = Math.min(range.endRow ?? extent.rows - 1, extent.rows - 1);
  const endCol = Math.min(range.endCol ?? extent.cols - 1, extent.cols - 1);
  for (let r = range.startRow; r <= endRow; r += 1) {
    for (let c = range.startCol; c <= endCol; c += 1) {
      range.tab.cells.delete(`${String(r)},${String(c)}`);
    }
  }
}
function rangeLabel(tab, startRow, startCol, values) {
  const rows = Math.max(1, values.length);
  const cols = Math.max(1, ...values.map((r) => r.length));
  const start = `${colIndexToLetter(startCol)}${String(startRow + 1)}`;
  const end = `${colIndexToLetter(startCol + cols - 1)}${String(startRow + rows)}`;
  return `${tab.title}!${start}:${end}`;
}
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const BOOLEAN = /^(true|false)$/i;
const EXPONENT = /[eE]/;
const EXPONENT_DIGITS = 2;
function scientific(value) {
  const [mantissa = "", exponent = ""] = value.toExponential(2).split("e");
  const sign = exponent.startsWith("-") ? "-" : "+";
  const digits = exponent.replace(/^[+-]/, "").padStart(EXPONENT_DIGITS, "0");
  return `${mantissa}E${sign}${digits}`;
}
function tabGrid(tab) {
  const used = tabExtent(tab);
  return {
    rows: Math.max(tab.rows, used.rows),
    cols: Math.max(tab.cols, used.cols)
  };
}
function cellData(text) {
  if (text === "") return {};
  const trimmed = text.trim();
  if (BOOLEAN.test(trimmed)) {
    const value2 = { boolValue: trimmed.toLowerCase() === "true" };
    return {
      userEnteredValue: value2,
      effectiveValue: value2,
      formattedValue: trimmed.toUpperCase()
    };
  }
  if (DECIMAL.test(trimmed)) {
    const number = Number(trimmed);
    const value2 = { numberValue: number };
    return {
      userEnteredValue: value2,
      effectiveValue: value2,
      formattedValue: EXPONENT.test(trimmed) ? scientific(number) : String(number)
    };
  }
  const value = { stringValue: text };
  return { userEnteredValue: value, effectiveValue: value, formattedValue: text };
}
function gridData(tab) {
  const rows = rangeValues({ tab, startRow: 0, startCol: 0, endRow: null, endCol: null });
  const grid = tabGrid(tab);
  return [
    {
      rowData: rows.map((row) => row.length === 0 ? {} : { values: row.map(cellData) }),
      rowMetadata: Array.from({ length: grid.rows }, () => ({ pixelSize: ROW_PIXELS })),
      columnMetadata: Array.from({ length: grid.cols }, () => ({ pixelSize: COLUMN_PIXELS }))
    }
  ];
}
function tabProperties(tab, index) {
  const grid = tabGrid(tab);
  return {
    sheetId: tab.sheetId,
    title: tab.title,
    index,
    sheetType: "GRID",
    gridProperties: { rowCount: grid.rows, columnCount: grid.cols }
  };
}
function fmtSpreadsheet(id, includeGridData = false) {
  const sheet = state.sheets.get(id);
  return {
    spreadsheetId: id,
    // The live API also carries defaultFormat and spreadsheetTheme here,
    // which are styling this server has no model for and mirage never
    // reads.
    properties: {
      title: sheet.title,
      locale: "en_US",
      autoRecalc: "ON_CHANGE",
      timeZone: "Etc/GMT"
    },
    sheets: sheet.tabs.map((tab, index) => ({
      properties: tabProperties(tab, index),
      // Real Sheets omits `data` entirely without includeGridData, which
      // is the whole reason mirage asks for it.
      ...includeGridData ? { data: gridData(tab) } : {}
    })),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`
  };
}
function resolveDimensionRange(sheet, raw) {
  const tab = sheet.tabs.find((t) => t.sheetId === (raw?.sheetId ?? 0));
  if (tab === void 0) return null;
  const dimension = raw?.dimension === "COLUMNS" ? "COLUMNS" : "ROWS";
  const limit = dimension === "ROWS" ? tab.rows : tab.cols;
  const startIndex = Math.max(0, raw?.startIndex ?? 0);
  const endIndex = Math.max(startIndex, raw?.endIndex ?? limit);
  return { tab, dimension, startIndex, endIndex };
}
function remapCells(tab, dimension, mapIndex) {
  const next = /* @__PURE__ */ new Map();
  for (const [key, value] of tab.cells) {
    const [row, col] = key.split(",").map(Number);
    const moved = mapIndex(dimension === "ROWS" ? row : col);
    if (moved === null) continue;
    next.set(
      dimension === "ROWS" ? `${String(moved)},${String(col)}` : `${String(row)},${String(moved)}`,
      value
    );
  }
  tab.cells = next;
}
function cellText(cell) {
  const value = cell?.userEnteredValue;
  if (value === void 0) return null;
  if (value.stringValue !== void 0) return value.stringValue;
  if (value.numberValue !== void 0) return String(value.numberValue);
  if (value.boolValue !== void 0) return value.boolValue ? "TRUE" : "FALSE";
  if (value.formulaValue !== void 0) return value.formulaValue;
  return null;
}
function fieldsTouchValue(fields) {
  if (fields === void 0 || fields.trim() === "") return true;
  return fields.split(",").some((entry) => {
    const head = entry.trim().split(/[.(]/)[0];
    return head === "*" || head === "userEnteredValue";
  });
}
function updateCells(sheet, request) {
  const grid = request.range ?? request.start;
  const tab = sheet.tabs.find((t) => t.sheetId === (grid?.sheetId ?? 0));
  if (tab === void 0) return googleError(400, "Invalid sheetId.", "INVALID_ARGUMENT");
  if (!fieldsTouchValue(request.fields)) return null;
  const rows = request.rows ?? [];
  const startRow = request.range?.startRowIndex ?? request.start?.rowIndex ?? 0;
  const startCol = request.range?.startColumnIndex ?? request.start?.columnIndex ?? 0;
  if (request.range !== void 0) {
    const endRow = Math.min(request.range.endRowIndex ?? tab.rows, tab.rows);
    const endCol = Math.min(request.range.endColumnIndex ?? tab.cols, tab.cols);
    for (let r = startRow; r < endRow; r += 1) {
      for (let c = startCol; c < endCol; c += 1) tab.cells.delete(`${String(r)},${String(c)}`);
    }
  }
  for (let i = 0; i < rows.length; i += 1) {
    const values = rows[i].values ?? [];
    for (let j = 0; j < values.length; j += 1) {
      const text = cellText(values[j]);
      const key = `${String(startRow + i)},${String(startCol + j)}`;
      if (text === null) tab.cells.delete(key);
      else tab.cells.set(key, text);
    }
  }
  return null;
}
function growGrid(tab, dimension, by) {
  if (dimension === "ROWS") tab.rows = Math.max(1, tab.rows + by);
  else tab.cols = Math.max(1, tab.cols + by);
}
function insertDimension(range) {
  const count = range.endIndex - range.startIndex;
  remapCells(range.tab, range.dimension, (i) => i >= range.startIndex ? i + count : i);
  growGrid(range.tab, range.dimension, count);
}
function deleteDimension(range) {
  const count = range.endIndex - range.startIndex;
  remapCells(range.tab, range.dimension, (i) => {
    if (i >= range.startIndex && i < range.endIndex) return null;
    return i >= range.endIndex ? i - count : i;
  });
  growGrid(range.tab, range.dimension, -count);
}
function moveDimension(range, destinationIndex) {
  const count = range.endIndex - range.startIndex;
  if (count === 0) return;
  if (destinationIndex >= range.startIndex && destinationIndex <= range.endIndex) return;
  const target = destinationIndex > range.endIndex ? destinationIndex - count : Math.max(0, destinationIndex);
  remapCells(range.tab, range.dimension, (i) => {
    if (i >= range.startIndex && i < range.endIndex) return target + (i - range.startIndex);
    const lifted = i >= range.endIndex ? i - count : i;
    return lifted >= target ? lifted + count : lifted;
  });
}
function sheetsBatchUpdate(id, requests) {
  const sheet = state.sheets.get(id);
  if (sheet === void 0) return NOT_FOUND;
  const replies = [];
  for (const request of requests) {
    if ("addSheet" in request) {
      const r = request.addSheet;
      const tab = newTab(
        sheet.nextSheetId,
        r.properties?.title ?? `Sheet${String(sheet.tabs.length + 1)}`,
        r.properties?.gridProperties?.rowCount ?? GRID_ROWS,
        r.properties?.gridProperties?.columnCount ?? GRID_COLUMNS
      );
      sheet.nextSheetId += 1;
      sheet.tabs.push(tab);
      replies.push({ addSheet: { properties: tabProperties(tab, sheet.tabs.length - 1) } });
    } else if ("deleteSheet" in request) {
      const r = request.deleteSheet;
      sheet.tabs = sheet.tabs.filter((t) => t.sheetId !== r.sheetId);
      replies.push({});
    } else if ("updateSheetProperties" in request) {
      const r = request.updateSheetProperties;
      const tab = sheet.tabs.find((t) => t.sheetId === r.properties?.sheetId);
      if (tab !== void 0 && r.properties?.title !== void 0) tab.title = r.properties.title;
      replies.push({});
    } else if ("duplicateSheet" in request) {
      const r = request.duplicateSheet;
      const src = sheet.tabs.find((t) => t.sheetId === (r.sourceSheetId ?? 0));
      if (src === void 0) {
        return googleError(400, "Invalid sourceSheetId.", "INVALID_ARGUMENT");
      }
      const copy = {
        ...src,
        sheetId: r.newSheetId ?? sheet.nextSheetId,
        title: r.newSheetName ?? `Copy of ${src.title}`,
        cells: new Map(src.cells)
      };
      if (r.newSheetId === void 0) sheet.nextSheetId += 1;
      const at = r.insertSheetIndex ?? sheet.tabs.length;
      sheet.tabs.splice(at, 0, copy);
      replies.push({ duplicateSheet: { properties: tabProperties(copy, at) } });
    } else if ("insertDimension" in request) {
      const r = request.insertDimension;
      const range = resolveDimensionRange(sheet, r.range);
      if (range === null) return googleError(400, "Invalid sheetId.", "INVALID_ARGUMENT");
      insertDimension(range);
      replies.push({});
    } else if ("deleteDimension" in request) {
      const r = request.deleteDimension;
      const range = resolveDimensionRange(sheet, r.range);
      if (range === null) return googleError(400, "Invalid sheetId.", "INVALID_ARGUMENT");
      deleteDimension(range);
      replies.push({});
    } else if ("appendDimension" in request) {
      const r = request.appendDimension;
      const tab = sheet.tabs.find((t) => t.sheetId === (r.sheetId ?? 0));
      if (tab === void 0) return googleError(400, "Invalid sheetId.", "INVALID_ARGUMENT");
      growGrid(tab, r.dimension === "COLUMNS" ? "COLUMNS" : "ROWS", r.length ?? 0);
      replies.push({});
    } else if ("moveDimension" in request) {
      const r = request.moveDimension;
      const range = resolveDimensionRange(sheet, r.source);
      if (range === null) return googleError(400, "Invalid sheetId.", "INVALID_ARGUMENT");
      moveDimension(range, r.destinationIndex ?? 0);
      replies.push({});
    } else if ("updateCells" in request) {
      const failed = updateCells(sheet, request.updateCells);
      if (failed !== null) return failed;
      replies.push({});
    } else if ("updateSpreadsheetProperties" in request) {
      const r = request.updateSpreadsheetProperties;
      if (r.properties?.title !== void 0) {
        sheet.title = r.properties.title;
        const file = state.files.get(id);
        if (file !== void 0) file.name = r.properties.title;
      }
      replies.push({});
    } else {
      return googleError(400, `Unsupported request: ${Object.keys(request).join(",")}`, "INVALID_ARGUMENT");
    }
  }
  touchNative(id);
  return [200, { spreadsheetId: id, replies }];
}
function batchGetValues(id, ranges) {
  const sheet = state.sheets.get(id);
  if (sheet === void 0) return NOT_FOUND;
  const valueRanges = [];
  for (const rangeStr of ranges) {
    const range = parseA1(sheet, rangeStr);
    if (range === null) {
      return googleError(400, `Unable to parse range: ${rangeStr}`, "INVALID_ARGUMENT");
    }
    valueRanges.push({
      range: rangeLabelFor(range, rangeStr),
      majorDimension: "ROWS",
      values: rangeValues(range)
    });
  }
  return [200, { spreadsheetId: id, valueRanges }];
}
function batchUpdateValues(id, data) {
  const sheet = state.sheets.get(id);
  if (sheet === void 0) return NOT_FOUND;
  const responses = [];
  const rows = /* @__PURE__ */ new Set();
  const columns = /* @__PURE__ */ new Set();
  const tabs = /* @__PURE__ */ new Set();
  let totalCells = 0;
  for (const entry of data) {
    const rangeStr = entry.range ?? "";
    const range = parseA1(sheet, rangeStr);
    if (range === null) {
      return googleError(400, `Unable to parse range: ${rangeStr}`, "INVALID_ARGUMENT");
    }
    const values = entry.values ?? [];
    const cells = writeValues(range, values, range.startRow);
    for (let i = 0; i < values.length; i += 1) {
      const row = values[i];
      if (row.length > 0) rows.add(`${String(range.tab.sheetId)},${String(range.startRow + i)}`);
      for (let j = 0; j < row.length; j += 1) {
        columns.add(`${String(range.tab.sheetId)},${String(range.startCol + j)}`);
      }
    }
    tabs.add(range.tab.sheetId);
    totalCells += cells;
    responses.push({
      spreadsheetId: id,
      updatedRange: rangeLabel(range.tab, range.startRow, range.startCol, values),
      updatedRows: values.length,
      updatedColumns: values.length > 0 ? Math.max(...values.map((r) => r.length)) : 0,
      updatedCells: cells
    });
  }
  touchNative(id);
  return [
    200,
    {
      spreadsheetId: id,
      totalUpdatedRows: rows.size,
      totalUpdatedColumns: columns.size,
      totalUpdatedCells: totalCells,
      totalUpdatedSheets: tabs.size,
      responses
    }
  ];
}
function batchClearValues(id, ranges) {
  const sheet = state.sheets.get(id);
  if (sheet === void 0) return NOT_FOUND;
  const clearedRanges = [];
  for (const rangeStr of ranges) {
    const range = parseA1(sheet, rangeStr);
    if (range === null) {
      return googleError(400, `Unable to parse range: ${rangeStr}`, "INVALID_ARGUMENT");
    }
    clearRange(range);
    clearedRanges.push(rangeLabelFor(range, rangeStr));
  }
  touchNative(id);
  return [200, { spreadsheetId: id, clearedRanges }];
}
function copySheetTo(sourceId, sheetId, destinationId) {
  const source = state.sheets.get(sourceId);
  const destination = state.sheets.get(destinationId);
  if (source === void 0 || destination === void 0) return NOT_FOUND;
  const tab = source.tabs.find((t) => t.sheetId === sheetId);
  if (tab === void 0) {
    return googleError(400, `Invalid sheetId: ${String(sheetId)}`, "INVALID_ARGUMENT");
  }
  const copy = {
    ...tab,
    sheetId: destination.nextSheetId,
    title: `Copy of ${tab.title}`,
    cells: new Map(tab.cells)
  };
  destination.nextSheetId += 1;
  destination.tabs.push(copy);
  touchNative(destinationId);
  return [200, tabProperties(copy, destination.tabs.length - 1)];
}
function newSlide(objectId) {
  return { objectId: objectId ?? state.nextId("slide"), texts: /* @__PURE__ */ new Map() };
}
function fmtPage(slide) {
  return {
    objectId: slide.objectId,
    pageElements: [...slide.texts.entries()].map(([objectId, text]) => ({
      objectId,
      shape: {
        shapeType: "TEXT_BOX",
        text: { textElements: [{ textRun: { content: text, style: {} } }] }
      }
    }))
  };
}
function fmtPresentation(id) {
  const pres = state.presentations.get(id);
  return {
    presentationId: id,
    title: pres.title,
    pageSize: {
      width: { magnitude: 9144e3, unit: "EMU" },
      height: { magnitude: 6858e3, unit: "EMU" }
    },
    slides: pres.slides.map(fmtPage),
    revisionId: `rev-${String(pres.slides.length)}`
  };
}
function slidesBatchUpdate(id, requests) {
  const pres = state.presentations.get(id);
  if (pres === void 0) return NOT_FOUND;
  const replies = [];
  for (const request of requests) {
    if ("createSlide" in request) {
      const r = request.createSlide;
      const slide = newSlide(r.objectId);
      pres.slides.splice(r.insertionIndex ?? pres.slides.length, 0, slide);
      replies.push({ createSlide: { objectId: slide.objectId } });
    } else if ("createShape" in request) {
      const r = request.createShape;
      const page = pres.slides.find((s) => s.objectId === r.elementProperties?.pageObjectId);
      const objectId = r.objectId ?? state.nextId("shape");
      if (page === void 0) {
        return googleError(400, "Invalid pageObjectId.", "INVALID_ARGUMENT");
      }
      if (pres.slides.some((s) => s.objectId === objectId || s.texts.has(objectId))) {
        return googleError(400, `Object id already exists: ${objectId}`, "INVALID_ARGUMENT");
      }
      page.texts.set(objectId, "");
      replies.push({ createShape: { objectId } });
    } else if ("insertText" in request) {
      const r = request.insertText;
      const objectId = r.objectId ?? "";
      const page = pres.slides.find((s) => s.texts.has(objectId));
      if (page === void 0) {
        return googleError(400, "Invalid insertText objectId.", "INVALID_ARGUMENT");
      }
      page.texts.set(objectId, (page.texts.get(objectId) ?? "") + (r.text ?? ""));
      replies.push({});
    } else if ("deleteText" in request) {
      const r = request.deleteText;
      const objectId = r.objectId ?? "";
      const page = pres.slides.find((s) => s.texts.has(objectId));
      if (page === void 0) {
        return googleError(400, "Invalid deleteText objectId.", "INVALID_ARGUMENT");
      }
      const text = page.texts.get(objectId) ?? "";
      const type = r.textRange?.type ?? "ALL";
      if (type === "ALL") {
        page.texts.set(objectId, "");
      } else if (type === "FROM_START_INDEX") {
        page.texts.set(objectId, text.slice(0, r.textRange?.startIndex ?? 0));
      } else {
        const start = r.textRange?.startIndex ?? 0;
        page.texts.set(objectId, text.slice(0, start) + text.slice(r.textRange?.endIndex ?? start));
      }
      replies.push({});
    } else if ("replaceAllText" in request) {
      const r = request.replaceAllText;
      const scope = r.pageObjectIds === void 0 ? pres.slides : pres.slides.filter((s) => r.pageObjectIds?.includes(s.objectId) === true);
      let occurrences = 0;
      for (const slide of scope) {
        for (const [objectId, text] of slide.texts) {
          const [next, changed] = replaceAllText(
            text,
            r.containsText?.text ?? "",
            r.replaceText ?? "",
            r.containsText?.matchCase ?? false
          );
          slide.texts.set(objectId, next);
          occurrences += changed;
        }
      }
      replies.push({ replaceAllText: { occurrencesChanged: occurrences } });
    } else if ("duplicateObject" in request) {
      const r = request.duplicateObject;
      const source = pres.slides.find((s) => s.objectId === r.objectId);
      if (source === void 0) {
        return googleError(400, "Invalid duplicateObject objectId.", "INVALID_ARGUMENT");
      }
      const renamed = [...source.texts].map(([objectId, text]) => [
        r.objectIds?.[objectId] ?? state.nextId("shape"),
        text
      ]);
      const copy = {
        objectId: r.objectIds?.[source.objectId] ?? state.nextId("slide"),
        texts: new Map(renamed)
      };
      pres.slides.splice(pres.slides.indexOf(source) + 1, 0, copy);
      replies.push({ duplicateObject: { objectId: copy.objectId } });
    } else if ("updateSlidesPosition" in request) {
      const r = request.updateSlidesPosition;
      const ids = new Set(r.slideObjectIds ?? []);
      const moving = pres.slides.filter((s) => ids.has(s.objectId));
      if (moving.length !== ids.size) {
        return googleError(400, "Invalid slideObjectIds.", "INVALID_ARGUMENT");
      }
      const rest = pres.slides.filter((s) => !ids.has(s.objectId));
      rest.splice(Math.min(r.insertionIndex ?? rest.length, rest.length), 0, ...moving);
      pres.slides = rest;
      replies.push({});
    } else if ("deleteObject" in request) {
      const r = request.deleteObject;
      pres.slides = pres.slides.filter((s) => s.objectId !== r.objectId);
      for (const slide of pres.slides) slide.texts.delete(r.objectId ?? "");
      replies.push({});
    } else {
      return googleError(400, `Unsupported request: ${Object.keys(request).join(",")}`, "INVALID_ARGUMENT");
    }
  }
  touchNative(id);
  return [200, { presentationId: id, replies }];
}
function b64url(data) {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(data) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function splitMime(raw) {
  let sep = raw.indexOf("\r\n\r\n");
  let sepLen = 4;
  if (sep === -1) {
    sep = raw.indexOf("\n\n");
    sepLen = 2;
  }
  const headers = /* @__PURE__ */ new Map();
  const head = sep === -1 ? raw.toString("utf-8") : raw.subarray(0, sep).toString("utf-8");
  let lastKey = "";
  for (const line of head.split(/\r?\n/)) {
    if ((line.startsWith(" ") || line.startsWith("	")) && lastKey !== "") {
      headers.set(lastKey, `${headers.get(lastKey) ?? ""} ${line.trim()}`);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    lastKey = line.slice(0, colon).trim().toLowerCase();
    headers.set(lastKey, line.slice(colon + 1).trim());
  }
  return { headers, body: sep === -1 ? Buffer.alloc(0) : raw.subarray(sep + sepLen) };
}
function decodePartBody(part) {
  const cte = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  if (cte === "base64") {
    return Buffer.from(part.body.toString("ascii").replace(/\s+/g, ""), "base64");
  }
  let body = part.body;
  while (body.length > 0 && (body[body.length - 1] === 10 || body[body.length - 1] === 13)) {
    body = body.subarray(0, body.length - 1);
  }
  return body;
}
function filenameOf(part) {
  const disposition = part.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/.exec(disposition);
  if (m !== null) return m[1];
  const n = /name="?([^";]+)"?/.exec(part.headers.get("content-type") ?? "");
  return n === null ? "" : n[1];
}
function parseRfc822(raw) {
  const top = splitMime(raw);
  const wanted = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "In-Reply-To", "References"];
  const headers = [];
  for (const name of wanted) {
    const value = top.headers.get(name.toLowerCase());
    if (value !== void 0) headers.push({ name, value });
  }
  const contentType = top.headers.get("content-type") ?? "text/plain";
  if (!contentType.toLowerCase().startsWith("multipart/")) {
    return { headers, bodyText: decodePartBody(top).toString("utf-8"), attachments: [] };
  }
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (m === null) throw new Error("missing MIME boundary");
  const boundary = `--${(m[1] ?? m[2]).trim()}`;
  let bodyText = "";
  const attachments = [];
  const text = top.body;
  let from = text.indexOf(boundary);
  while (from !== -1) {
    const start = from + boundary.length;
    if (text.subarray(start, start + 2).toString() === "--") break;
    const next = text.indexOf(boundary, start);
    if (next === -1) break;
    let chunk = text.subarray(start, next);
    while (chunk.length > 0 && (chunk[0] === 10 || chunk[0] === 13)) chunk = chunk.subarray(1);
    const part = splitMime(chunk);
    const partType = (part.headers.get("content-type") ?? "text/plain").split(";")[0]?.trim() ?? "";
    const filename = filenameOf(part);
    if (filename !== "") {
      attachments.push({ filename, mimeType: partType, data: decodePartBody(part) });
    } else if (partType === "text/plain" || partType === "") {
      bodyText = decodePartBody(part).toString("utf-8");
    }
    from = next;
  }
  return { headers, bodyText, attachments };
}
function gmailHeader(msg, name) {
  const found = msg.headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found === void 0 ? "" : found.value;
}
function gmailSnippet(text) {
  const flat = text.split(/\s+/).filter((w) => w !== "").join(" ");
  return flat.length > 100 ? flat.slice(0, 100) : flat;
}
function gmailSizeEstimate(msg) {
  return Buffer.byteLength(msg.bodyText, "utf-8") + msg.attachments.reduce((total, a) => total + a.data.length, 0);
}
function fmtGmailMessage(msg) {
  const headers = msg.headers.map((h) => ({ name: h.name, value: h.value }));
  const bodyData = Buffer.from(msg.bodyText, "utf-8");
  let payload;
  if (msg.attachments.length === 0) {
    payload = {
      partId: "",
      mimeType: "text/plain",
      filename: "",
      headers,
      body: { size: bodyData.length, data: b64url(bodyData) }
    };
  } else {
    const parts = [
      {
        partId: "0",
        mimeType: "text/plain",
        filename: "",
        headers: [],
        body: { size: bodyData.length, data: b64url(bodyData) }
      }
    ];
    msg.attachments.forEach((att, i) => {
      parts.push({
        partId: String(i + 1),
        mimeType: att.mimeType,
        filename: att.filename,
        headers: [],
        body: { attachmentId: att.attachmentId, size: att.data.length }
      });
    });
    payload = { partId: "", mimeType: "multipart/mixed", filename: "", headers, body: { size: 0 }, parts };
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: [...msg.labelIds],
    snippet: gmailSnippet(msg.bodyText),
    internalDate: String(msg.internalDate),
    sizeEstimate: gmailSizeEstimate(msg),
    payload
  };
}
function labelByName(name) {
  const lower = name.toLowerCase();
  return [...state.labels.values()].find(
    (label) => label.name.toLowerCase() === lower || label.id.toLowerCase() === lower
  );
}
function gmailDateMs(token) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(token);
  if (m !== null) {
    return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  if (/^\d+$/.test(token)) return parseInt(token, 10) * 1e3;
  return NaN;
}
function matchGmailQuery(msg, q) {
  for (const token of q.split(/\s+/)) {
    if (token === "") continue;
    const lower = token.toLowerCase();
    if (lower.startsWith("label:")) {
      const label = labelByName(token.slice(6));
      if (label === void 0 || !msg.labelIds.includes(label.id)) return false;
    } else if (lower.startsWith("from:")) {
      if (!gmailHeader(msg, "From").toLowerCase().includes(lower.slice(5))) return false;
    } else if (lower.startsWith("to:")) {
      if (!gmailHeader(msg, "To").toLowerCase().includes(lower.slice(3))) return false;
    } else if (lower.startsWith("subject:")) {
      if (!gmailHeader(msg, "Subject").toLowerCase().includes(lower.slice(8))) return false;
    } else if (lower === "is:unread") {
      if (!msg.labelIds.includes("UNREAD")) return false;
    } else if (lower === "is:read") {
      if (msg.labelIds.includes("UNREAD")) return false;
    } else if (lower.startsWith("after:")) {
      const ms = gmailDateMs(token.slice(6));
      if (Number.isNaN(ms) || msg.internalDate < ms) return false;
    } else if (lower.startsWith("before:")) {
      const ms = gmailDateMs(token.slice(7));
      if (Number.isNaN(ms) || msg.internalDate >= ms) return false;
    } else {
      const haystack = `${gmailHeader(msg, "Subject")}
${msg.bodyText}`.toLowerCase();
      if (!haystack.includes(lower)) return false;
    }
  }
  return true;
}
function ensureLabel(name) {
  const existing = labelByName(name);
  if (existing !== void 0) return existing;
  const label = { id: state.nextId("label"), name, type: "user" };
  state.labels.set(label.id, label);
  return label;
}
function insertGmailMessage(raw, labelIds, threadId, useDateHeader) {
  const parsed = parseRfc822(raw);
  const id = state.nextId("msg");
  const dateHeader = parsed.headers.find((h) => h.name === "Date")?.value;
  const headerMs = dateHeader === void 0 ? NaN : Date.parse(dateHeader);
  const msg = {
    id,
    threadId: threadId !== void 0 && threadId !== "" ? threadId : id,
    labelIds: labelIds.map((name) => ensureLabel(name).id),
    internalDate: useDateHeader && !Number.isNaN(headerMs) ? headerMs : state.nowMs(),
    headers: parsed.headers,
    bodyText: parsed.bodyText,
    attachments: parsed.attachments.map((att) => ({
      attachmentId: state.nextId("att"),
      filename: att.filename,
      mimeType: att.mimeType,
      data: att.data
    }))
  };
  state.messages.set(id, msg);
  return msg;
}
function listGmailMessages(query) {
  const q = query.get("q");
  const labelParam = query.get("labelIds");
  const maxResults = parseInt(query.get("maxResults") ?? "100", 10);
  let items = [...state.messages.values()];
  if (labelParam !== null) {
    items = items.filter((msg) => msg.labelIds.includes(labelParam));
  } else if (q === null || !q.includes("label:TRASH")) {
    items = items.filter((msg) => !msg.labelIds.includes("TRASH"));
  }
  if (q !== null && q.trim() !== "") {
    items = items.filter((msg) => matchGmailQuery(msg, q));
  }
  items.sort(
    (a, b) => a.internalDate === b.internalDate ? b.id.localeCompare(a.id) : b.internalDate - a.internalDate
  );
  items = items.slice(0, maxResults);
  const out = { resultSizeEstimate: items.length };
  if (items.length > 0) {
    out.messages = items.map((msg) => ({ id: msg.id, threadId: msg.threadId }));
  }
  return [200, out];
}
function routeGmail(ctx) {
  const { method, path, query } = ctx;
  if (path === "/gmail/v1/users/me/labels" && method === "GET") {
    return [
      200,
      {
        labels: [...state.labels.values()].map((label) => ({
          id: label.id,
          name: label.name,
          type: label.type
        }))
      }
    ];
  }
  if (path === "/gmail/v1/users/me/messages" && method === "GET") {
    return listGmailMessages(query);
  }
  if (path === "/gmail/v1/users/me/messages" && method === "POST") {
    const body = json(ctx);
    if (typeof body.raw !== "string") {
      return googleError(400, "'raw' RFC822 payload is required.", "INVALID_ARGUMENT");
    }
    const msg = insertGmailMessage(
      b64urlDecode(body.raw),
      body.labelIds ?? [],
      body.threadId,
      query.get("internalDateSource") === "dateHeader"
    );
    return [200, { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] }];
  }
  if (path === "/gmail/v1/users/me/messages/send" && method === "POST") {
    const body = json(ctx);
    if (typeof body.raw !== "string") {
      return googleError(400, "'raw' RFC822 payload is required.", "INVALID_ARGUMENT");
    }
    const msg = insertGmailMessage(b64urlDecode(body.raw), ["SENT"], body.threadId, false);
    return [200, { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] }];
  }
  let m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/trash$/.exec(path);
  if (m !== null && method === "POST") {
    const msg = state.messages.get(m[1]);
    if (msg === void 0) return googleError(404, "Requested entity was not found.", "NOT_FOUND");
    msg.labelIds = msg.labelIds.filter((id) => id !== "INBOX" && id !== "UNREAD");
    msg.labelIds.push("TRASH");
    return [200, { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] }];
  }
  m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
  if (m !== null && method === "GET") {
    const msg = state.messages.get(m[1]);
    const att = msg?.attachments.find((a) => a.attachmentId === m?.[2]);
    if (msg === void 0 || att === void 0) {
      return googleError(404, "Requested entity was not found.", "NOT_FOUND");
    }
    return [200, { size: att.data.length, data: b64url(att.data) }];
  }
  m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(path);
  if (m !== null && method === "GET") {
    const msg = state.messages.get(m[1]);
    if (msg === void 0) return googleError(404, "Requested entity was not found.", "NOT_FOUND");
    return [200, fmtGmailMessage(msg)];
  }
  return null;
}
function parseMultipartRelated(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (m === null) throw new Error("missing multipart boundary");
  const boundary = Buffer.from("--" + (m[1] ?? m[2]).trim());
  const parts = [];
  let from = body.indexOf(boundary);
  while (from !== -1) {
    const start = from + boundary.length;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    parts.push(body.subarray(start, next));
    from = next;
  }
  if (parts.length < 2) throw new Error("expected two multipart parts");
  const strip = (part) => {
    let sep = part.indexOf("\r\n\r\n");
    let sepLen = 4;
    if (sep === -1) {
      sep = part.indexOf("\n\n");
      sepLen = 2;
    }
    let out = part.subarray(sep + sepLen);
    if (out.length >= 2 && out.subarray(out.length - 2).toString() === "\r\n") {
      out = out.subarray(0, out.length - 2);
    }
    return out;
  };
  const metadata = JSON.parse(strip(parts[0]).toString("utf-8"));
  return { metadata, media: strip(parts[1]) };
}
function media(content, range) {
  const octet = "application/octet-stream";
  if (!range.startsWith("bytes=")) return [200, content, octet];
  const [startText, endText] = range.slice("bytes=".length).split("-");
  const start = startText === "" ? 0 : Number(startText);
  const end = endText === void 0 || endText === "" ? content.length : Number(endText) + 1;
  if (start >= content.length) return [416, Buffer.alloc(0), octet];
  return [206, content.subarray(start, Math.min(end, content.length)), octet];
}
function json(ctx) {
  if (ctx.body.length === 0) return {};
  return JSON.parse(ctx.body.toString("utf-8"));
}
function route(ctx) {
  const { method, path, query } = ctx;
  if (method === "POST" && path === "/token") {
    return [200, { access_token: "gws-integ-token", expires_in: 3600, token_type: "Bearer" }];
  }
  if (method === "POST" && path === "/reset") {
    const body = ctx.body.length > 0 ? json(ctx) : {};
    state = new GwsState(body.epoch, body.calendarTimeZone);
    if (body.capturedSheets !== void 0) restoreSheets(body.capturedSheets);
    if (body.calendars !== void 0) seedCalendars(body.calendars);
    if (body.forms !== void 0) seedForms(body.forms);
    return [200, { ok: true }];
  }
  if (path.startsWith("/gmail/v1/")) {
    const handled = routeGmail(ctx);
    if (handled !== null) return handled;
  }
  if (path.startsWith("/calendar/v3/")) {
    const handled = routeCalendar(ctx);
    if (handled !== null) return handled;
  }
  if (path.startsWith("/v1/forms")) {
    const handled = routeForms(ctx);
    if (handled !== null) return handled;
  }
  let m = /^\/upload\/drive\/v3\/files$/.exec(path);
  if (m !== null && method === "POST") {
    if (query.get("uploadType") === "multipart") {
      const { metadata, media: media2 } = parseMultipartRelated(ctx.body, ctx.contentType);
      const item2 = createDriveItem(
        String(metadata.name ?? "Untitled"),
        String(metadata.mimeType ?? "application/octet-stream"),
        Array.isArray(metadata.parents) ? metadata.parents : [],
        media2
      );
      return [200, fmtFile(item2)];
    }
    const item = createDriveItem("Untitled", "application/octet-stream", [], ctx.body);
    return [200, fmtFile(item)];
  }
  m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
  if (m !== null && method === "PATCH") {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    item.content = ctx.body;
    item.modifiedTime = state.now();
    pushRevision(item);
    return [200, fmtFile(item)];
  }
  if (path === "/drive/v3/files" && method === "GET") return listFiles(query);
  if (path === "/drive/v3/files" && method === "POST") {
    const body = json(ctx);
    const pinned = typeof body.id === "string" ? body.id : void 0;
    if (pinned !== void 0 && state.files.has(pinned)) {
      return googleError(409, "A file with that id already exists.", "ALREADY_EXISTS");
    }
    const item = createDriveItem(
      String(body.name ?? "Untitled"),
      String(body.mimeType ?? "application/octet-stream"),
      Array.isArray(body.parents) ? body.parents : [],
      Buffer.alloc(0),
      pinned
    );
    return [200, fmtFile(item)];
  }
  if (path === "/drive/v3/about" && method === "GET") {
    return [
      200,
      {
        kind: "drive#about",
        user: { kind: "drive#user", ...OWNER, permissionId: "owner" },
        storageQuota: {
          limit: String(15 * 1024 * 1024 * 1024),
          usage: String([...state.files.values()].reduce((n, f) => n + f.content.length, 0))
        }
      }
    ];
  }
  if (path === "/drive/v3/drives" && method === "POST") {
    const body = json(ctx);
    const id = state.nextId("drive");
    state.drives.set(id, { id, name: body.name ?? "Untitled drive" });
    const root = createDriveItem(body.name ?? "Untitled drive", FOLDER_MIME, [], Buffer.alloc(0), id);
    root.parents = [];
    root.driveId = id;
    return [200, { kind: "drive#drive", id, name: body.name ?? "Untitled drive" }];
  }
  if (path === "/drive/v3/drives" && method === "GET") {
    return [
      200,
      {
        kind: "drive#driveList",
        drives: [...state.drives.values()].map((d) => ({ kind: "drive#drive", ...d }))
      }
    ];
  }
  m = /^\/drive\/v3\/drives\/([^/:]+)$/.exec(path);
  if (m !== null) {
    const drive = state.drives.get(m[1]);
    if (drive === void 0) return NOT_FOUND;
    if (method === "GET") return [200, { kind: "drive#drive", ...drive }];
    if (method === "PATCH") {
      const body = json(ctx);
      if (typeof body.name === "string") {
        drive.name = body.name;
        const root = state.files.get(drive.id);
        if (root !== void 0) root.name = body.name;
      }
      return [200, { kind: "drive#drive", ...drive }];
    }
    if (method === "DELETE") {
      for (const item of [...state.files.values()]) {
        if (item.driveId === drive.id) deleteTree(item.id);
      }
      state.drives.delete(drive.id);
      return [204, null];
    }
  }
  if (path === "/drive/v3/files/generateIds" && method === "GET") {
    const count = Number.parseInt(query.get("count") ?? "10", 10);
    const total = Number.isNaN(count) || count < 1 ? 10 : count;
    return [
      200,
      {
        kind: "drive#generatedIds",
        space: query.get("space") ?? "drive",
        ids: Array.from({ length: total }, () => state.nextId("f"))
      }
    ];
  }
  if (path === "/drive/v3/files/trash" && method === "DELETE") {
    for (const item of [...state.files.values()]) {
      if (item.trashed) deleteTree(item.id);
    }
    return [204, null];
  }
  m = /^\/drive\/v3\/files\/([^/:]+)$/.exec(path);
  if (m !== null) {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    if (method === "GET" && query.get("alt") === "media") {
      return media(item.content, ctx.range);
    }
    if (method === "GET") return [200, fmtFile(item)];
    if (method === "PATCH") {
      const body = json(ctx);
      if (typeof body.name === "string") {
        item.name = body.name;
        const doc = state.docs.get(item.id);
        if (doc !== void 0) doc.title = body.name;
        const sheet = state.sheets.get(item.id);
        if (sheet !== void 0) sheet.title = body.name;
        const pres = state.presentations.get(item.id);
        if (pres !== void 0) pres.title = body.name;
      }
      if (typeof body.trashed === "boolean") item.trashed = body.trashed;
      const add = query.get("addParents");
      const remove = query.get("removeParents");
      if (add !== null) item.parents.push(...add.split(","));
      if (remove !== null) {
        const removed = new Set(remove.split(","));
        item.parents = item.parents.filter((p) => !removed.has(p));
        if (item.parents.length === 0) item.parents = ["root"];
      }
      item.modifiedTime = state.now();
      return [200, fmtFile(item)];
    }
    if (method === "DELETE") {
      deleteTree(item.id);
      return [204, null];
    }
  }
  m = /^\/drive\/v3\/files\/([^/]+)\/copy$/.exec(path);
  if (m !== null && method === "POST") {
    const src = state.files.get(m[1]);
    if (src === void 0) return NOT_FOUND;
    const body = json(ctx);
    const copy = createDriveItem(
      String(body.name ?? `Copy of ${src.name}`),
      src.mimeType,
      Array.isArray(body.parents) ? body.parents : [...src.parents],
      Buffer.from(src.content)
    );
    const srcDoc = state.docs.get(src.id);
    if (srcDoc !== void 0) state.docs.set(copy.id, { title: copy.name, text: srcDoc.text });
    const srcSheet = state.sheets.get(src.id);
    if (srcSheet !== void 0) {
      state.sheets.set(copy.id, {
        title: copy.name,
        nextSheetId: srcSheet.nextSheetId,
        tabs: srcSheet.tabs.map((t) => ({ ...t, cells: new Map(t.cells) }))
      });
    }
    const srcPres = state.presentations.get(src.id);
    if (srcPres !== void 0) {
      state.presentations.set(copy.id, {
        title: copy.name,
        slides: srcPres.slides.map((s) => ({ objectId: s.objectId, texts: new Map(s.texts) }))
      });
    }
    return [200, fmtFile(copy)];
  }
  m = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(path);
  if (m !== null && method === "GET") {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    return exportFile(item, query.get("mimeType") ?? "");
  }
  m = /^\/drive\/v3\/files\/([^/]+)\/revisions$/.exec(path);
  if (m !== null && method === "GET") {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    return [
      200,
      {
        kind: "drive#revisionList",
        revisions: item.revisions.map((r) => ({
          kind: "drive#revision",
          id: r.id,
          modifiedTime: r.modifiedTime,
          md5Checksum: r.md5Checksum,
          size: String(r.content.length)
        }))
      }
    ];
  }
  m = /^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/.exec(path);
  if (m !== null && method === "GET") {
    const item = state.files.get(m[1]);
    const revision = item?.revisions.find((r) => r.id === m?.[2]);
    if (item === void 0 || revision === void 0) return NOT_FOUND;
    if (query.get("alt") === "media") return media(revision.content, ctx.range);
    return [
      200,
      {
        kind: "drive#revision",
        id: revision.id,
        modifiedTime: revision.modifiedTime,
        md5Checksum: revision.md5Checksum,
        size: String(revision.content.length)
      }
    ];
  }
  if (m !== null && method === "DELETE") {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    const before = item.revisions.length;
    item.revisions = item.revisions.filter((r) => r.id !== m?.[2]);
    if (item.revisions.length === before) {
      return googleError(404, "Revision not found.", "NOT_FOUND");
    }
    return [204, null];
  }
  m = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(path);
  if (m !== null) {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    if (method === "GET") {
      return [200, { kind: "drive#permissionList", permissions: item.permissions }];
    }
    if (method === "POST") {
      const body = json(ctx);
      const permission = {
        id: state.nextId("perm"),
        role: String(body.role ?? "reader"),
        type: String(body.type ?? "user"),
        ...typeof body.emailAddress === "string" ? { emailAddress: body.emailAddress } : {}
      };
      item.permissions.push(permission);
      return [200, { kind: "drive#permission", ...permission }];
    }
  }
  m = /^\/drive\/v3\/files\/([^/]+)\/permissions\/([^/]+)$/.exec(path);
  if (m !== null) {
    const item = state.files.get(m[1]);
    if (item === void 0) return NOT_FOUND;
    const permission = item.permissions.find((p) => p.id === m?.[2]);
    if (method === "GET") {
      if (permission === void 0) return googleError(404, "Permission not found.", "NOT_FOUND");
      return [200, { kind: "drive#permission", ...permission }];
    }
    if (method === "PATCH") {
      if (permission === void 0) return googleError(404, "Permission not found.", "NOT_FOUND");
      const body = json(ctx);
      if (typeof body.role === "string") permission.role = body.role;
      return [200, { kind: "drive#permission", ...permission }];
    }
    if (method === "DELETE") {
      if (permission === void 0) return googleError(404, "Permission not found.", "NOT_FOUND");
      item.permissions = item.permissions.filter((p) => p.id !== m?.[2]);
      return [204, null];
    }
  }
  if (path === "/v1/documents" && method === "POST") {
    const body = json(ctx);
    const title = String(body.title ?? "Untitled document");
    const item = createDriveItem(title, DOC_MIME, [], Buffer.alloc(0), state.nextId("doc"));
    return [200, fmtDocument(item.id)];
  }
  m = /^\/v1\/documents\/([^/:]+)$/.exec(path);
  if (m !== null && method === "GET") {
    if (!state.docs.has(m[1])) return NOT_FOUND;
    return [200, fmtDocument(m[1])];
  }
  m = /^\/v1\/documents\/([^/:]+):batchUpdate$/.exec(path);
  if (m !== null && method === "POST") {
    const body = json(ctx);
    return docsBatchUpdate(m[1], body.requests ?? []);
  }
  if (path === "/v4/spreadsheets" && method === "POST") {
    const body = json(ctx);
    const properties = body.properties ?? {};
    const title = String(properties.title ?? "Untitled spreadsheet");
    const item = createDriveItem(title, SHEET_MIME, [], Buffer.alloc(0), state.nextId("sheet"));
    return [200, fmtSpreadsheet(item.id)];
  }
  m = /^\/v4\/spreadsheets\/([^/:]+)$/.exec(path);
  if (m !== null && method === "GET") {
    if (!state.sheets.has(m[1])) return NOT_FOUND;
    return [200, fmtSpreadsheet(m[1], query.get("includeGridData") === "true")];
  }
  m = /^\/v4\/spreadsheets\/([^/:]+):batchUpdate$/.exec(path);
  if (m !== null && method === "POST") {
    const body = json(ctx);
    return sheetsBatchUpdate(m[1], body.requests ?? []);
  }
  m = /^\/v4\/spreadsheets\/([^/:]+)\/values:batchGet$/.exec(path);
  if (m !== null && method === "GET") {
    return batchGetValues(m[1], query.getAll("ranges"));
  }
  m = /^\/v4\/spreadsheets\/([^/:]+)\/values:batchUpdate$/.exec(path);
  if (m !== null && method === "POST") {
    const body = json(ctx);
    return batchUpdateValues(
      m[1],
      body.data ?? []
    );
  }
  m = /^\/v4\/spreadsheets\/([^/:]+)\/values:batchClear$/.exec(path);
  if (m !== null && method === "POST") {
    const body = json(ctx);
    return batchClearValues(m[1], body.ranges ?? []);
  }
  m = /^\/v4\/spreadsheets\/([^/:]+)\/sheets\/(\d+):copyTo$/.exec(path);
  if (m !== null && method === "POST") {
    const body = json(ctx);
    return copySheetTo(
      m[1],
      Number.parseInt(m[2], 10),
      String(body.destinationSpreadsheetId ?? m[1])
    );
  }
  const isAppend = path.endsWith(":append");
  const isClear = path.endsWith(":clear");
  let valuesPath = path;
  if (isAppend) valuesPath = path.slice(0, -":append".length);
  else if (isClear) valuesPath = path.slice(0, -":clear".length);
  m = /^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/.exec(valuesPath);
  if (m !== null) {
    const sheet = state.sheets.get(m[1]);
    if (sheet === void 0) return NOT_FOUND;
    const rangeStr = decodeURIComponent(m[2]);
    const range = parseA1(sheet, rangeStr);
    if (range === null) {
      return googleError(400, `Unable to parse range: ${rangeStr}`, "INVALID_ARGUMENT");
    }
    if (method === "GET") {
      return [
        200,
        {
          range: rangeLabelFor(range, rangeStr),
          majorDimension: "ROWS",
          values: rangeValues(range)
        }
      ];
    }
    if (isClear && method === "POST") {
      clearRange(range);
      touchNative(m[1]);
      return [200, { spreadsheetId: m[1], clearedRange: rangeLabelFor(range, rangeStr) }];
    }
    const body = json(ctx);
    const values = body.values ?? [];
    if (isAppend && method === "POST") {
      const extent = tabExtent(range.tab);
      const startRow = Math.max(extent.rows, range.startRow);
      const cells = writeValues(range, values, startRow);
      touchNative(m[1]);
      return [
        200,
        {
          spreadsheetId: m[1],
          // The table the append found, which the live API reports only
          // when there was one; an empty tab has no tableRange at all.
          ...extent.rows > 0 ? {
            tableRange: `${range.tab.title}!A1:${colIndexToLetter(extent.cols - 1)}${String(extent.rows)}`
          } : {},
          updates: {
            spreadsheetId: m[1],
            updatedRange: rangeLabel(range.tab, startRow, range.startCol, values),
            updatedRows: values.length,
            updatedColumns: values.length > 0 ? Math.max(...values.map((r) => r.length)) : 0,
            updatedCells: cells
          }
        }
      ];
    }
    if (method === "PUT") {
      const cells = writeValues(range, values, range.startRow);
      touchNative(m[1]);
      return [
        200,
        {
          spreadsheetId: m[1],
          updatedRange: rangeLabel(range.tab, range.startRow, range.startCol, values),
          updatedRows: values.length,
          updatedColumns: values.length > 0 ? Math.max(...values.map((r) => r.length)) : 0,
          updatedCells: cells
        }
      ];
    }
  }
  if (path === "/v1/presentations" && method === "POST") {
    const body = json(ctx);
    const title = String(body.title ?? "Untitled presentation");
    const item = createDriveItem(title, SLIDE_MIME, [], Buffer.alloc(0), state.nextId("pres"));
    return [200, fmtPresentation(item.id)];
  }
  m = /^\/v1\/presentations\/([^/:]+)$/.exec(path);
  if (m !== null && method === "GET") {
    if (!state.presentations.has(m[1])) return NOT_FOUND;
    return [200, fmtPresentation(m[1])];
  }
  m = /^\/v1\/presentations\/([^/:]+)\/pages\/([^/:]+)$/.exec(path);
  if (m !== null && method === "GET") {
    const pres = state.presentations.get(m[1]);
    const slide = pres?.slides.find((s) => s.objectId === m?.[2]);
    if (slide === void 0) return NOT_FOUND;
    return [200, fmtPage(slide)];
  }
  m = /^\/v1\/presentations\/([^/:]+):batchUpdate$/.exec(path);
  if (m !== null && method === "POST") {
    const body = json(ctx);
    return slidesBatchUpdate(m[1], body.requests ?? []);
  }
  return googleError(404, `Unknown route: ${method} ${path}`, "NOT_FOUND");
}
function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(instant));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - instant;
}
function wallClockMs(naive, timeZone) {
  const guess = Date.parse(`${naive}Z`);
  const once = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(once, timeZone);
}
function zonedMidnight(date, timeZone) {
  return wallClockMs(`${date}T00:00:00`, timeZone);
}
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;
function slotMs(slot, fallbackTz) {
  if (slot.dateTime !== void 0) {
    if (HAS_OFFSET.test(slot.dateTime)) return Date.parse(slot.dateTime);
    return wallClockMs(slot.dateTime, slot.timeZone ?? fallbackTz);
  }
  if (slot.date !== void 0) return zonedMidnight(slot.date, fallbackTz);
  return null;
}
function eventStartMs(ev, tz) {
  return slotMs(ev.start, tz) ?? 0;
}
function eventEndMs(ev, tz) {
  return slotMs(ev.end, tz) ?? eventStartMs(ev, tz);
}
function calendarOr404(id) {
  const decoded = decodeURIComponent(id);
  const key = decoded === "primary" ? PRIMARY_CALENDAR_ID : decoded;
  return state.calendars.get(key) ?? null;
}
function eventsOf(calendarId) {
  let bucket = state.events.get(calendarId);
  if (bucket === void 0) {
    bucket = /* @__PURE__ */ new Map();
    state.events.set(calendarId, bucket);
  }
  return bucket;
}
function fmtEvent(cal, ev) {
  const out = {
    kind: "calendar#event",
    id: ev.id,
    status: ev.status,
    start: ev.start,
    end: ev.end,
    created: ev.created,
    updated: ev.updated,
    iCalUID: `${ev.id}@google.com`,
    htmlLink: `https://www.google.com/calendar/event?eid=${ev.id}`
  };
  if (cal.accessRole !== "freeBusyReader") {
    if (ev.summary !== void 0) out.summary = ev.summary;
    if (ev.description !== void 0) out.description = ev.description;
    if (ev.location !== void 0) out.location = ev.location;
    if (ev.attendees !== void 0) out.attendees = ev.attendees;
  }
  return out;
}
function matchesQ(ev, q) {
  const needle = q.toLowerCase();
  const hay = [ev.summary, ev.description, ev.location].filter((v) => v !== void 0);
  return hay.some((v) => v.toLowerCase().includes(needle));
}
function listCalendarEvents(cal, query) {
  const tz = query.get("timeZone") ?? cal.timeZone;
  const showDeleted = query.get("showDeleted") === "true";
  const q = query.get("q");
  const timeMin = query.get("timeMin");
  const timeMax = query.get("timeMax");
  let rows = [...eventsOf(cal.id).values()];
  if (!showDeleted) rows = rows.filter((ev) => ev.status !== "cancelled");
  if (timeMin !== null) {
    const bound = Date.parse(timeMin);
    rows = rows.filter((ev) => eventEndMs(ev, cal.timeZone) > bound);
  }
  if (timeMax !== null) {
    const bound = Date.parse(timeMax);
    rows = rows.filter((ev) => eventStartMs(ev, cal.timeZone) < bound);
  }
  if (q !== null) rows = rows.filter((ev) => matchesQ(ev, q));
  if (query.get("orderBy") === "startTime") {
    rows.sort((a, b) => eventStartMs(a, cal.timeZone) - eventStartMs(b, cal.timeZone));
  }
  const max = Number(query.get("maxResults") ?? "250");
  const start = Number(query.get("pageToken") ?? "0");
  const page = rows.slice(start, start + max);
  const out = {
    kind: "calendar#events",
    summary: cal.summary,
    timeZone: tz,
    accessRole: cal.accessRole,
    items: page.map((ev) => fmtEvent(cal, ev))
  };
  if (start + max < rows.length) out.nextPageToken = String(start + max);
  return [200, out];
}
function readEventTimes(body, fallback) {
  const start = body.start ?? fallback?.start;
  const end = body.end ?? fallback?.end;
  if (start === void 0 || end === void 0) return null;
  for (const t of [start, end]) {
    if (t.date === void 0 && t.dateTime === void 0) return null;
  }
  return { start, end };
}
function makeEvent(body) {
  const times = readEventTimes(body);
  if (times === null) return null;
  const now = state.now();
  return {
    id: state.nextEventId(),
    status: "confirmed",
    summary: body.summary,
    description: body.description,
    location: body.location,
    attendees: body.attendees,
    start: times.start,
    end: times.end,
    created: now,
    updated: now
  };
}
function seedCalendars(entries) {
  for (const entry of entries) {
    state.calendars.set(entry.id, {
      id: entry.id,
      summary: entry.summary,
      timeZone: entry.timeZone ?? DEFAULT_CALENDAR_TZ,
      accessRole: entry.accessRole ?? "owner",
      ...entry.primary === true ? { primary: true } : {},
      ...entry.hidden === true ? { hidden: true } : {}
    });
    const bucket = eventsOf(entry.id);
    for (const raw of entry.events ?? []) {
      const ev = makeEvent(raw);
      if (ev === null) throw new Error(`seed event needs a start and an end: ${JSON.stringify(raw)}`);
      for (const field of ["id", "status", "created", "updated"]) {
        if (raw[field] !== void 0) ev[field] = raw[field];
      }
      bucket.set(ev.id, ev);
    }
  }
}
function seedForms(entries) {
  for (const entry of entries) {
    const item = createDriveItem(
      entry.documentTitle ?? entry.title,
      FORM_MIME,
      [],
      Buffer.alloc(0),
      state.nextId("form")
    );
    state.forms.set(item.id, {
      formId: item.id,
      title: entry.title,
      documentTitle: entry.documentTitle ?? entry.title,
      ...entry.description === void 0 ? {} : { description: entry.description },
      items: (entry.items ?? []).map((raw) => ({
        itemId: state.nextId("item"),
        ...raw
      })),
      responses: entry.responses ?? [],
      revision: 1
    });
  }
}
function routeCalendar(ctx) {
  const { method, path, query } = ctx;
  const base = "/calendar/v3";
  if (path === `${base}/users/me/calendarList` && method === "GET") {
    const showHidden = query.get("showHidden") === "true";
    const items = [...state.calendars.values()].filter((c) => showHidden || c.hidden !== true);
    return [
      200,
      {
        kind: "calendar#calendarList",
        items: items.map((c) => ({
          kind: "calendar#calendarListEntry",
          id: c.id,
          summary: c.summary,
          timeZone: c.timeZone,
          accessRole: c.accessRole,
          ...c.primary === true ? { primary: true } : {}
        }))
      }
    ];
  }
  let m = new RegExp(`^${base}/calendars/([^/]+)$`).exec(path);
  if (m !== null && method === "GET") {
    const cal = calendarOr404(m[1]);
    if (cal === null) return NOT_FOUND;
    return [
      200,
      { kind: "calendar#calendar", id: cal.id, summary: cal.summary, timeZone: cal.timeZone }
    ];
  }
  m = new RegExp(`^${base}/calendars/([^/]+)/events$`).exec(path);
  if (m !== null) {
    const cal = calendarOr404(m[1]);
    if (cal === null) return NOT_FOUND;
    if (method === "GET") return listCalendarEvents(cal, query);
    if (method === "POST") {
      if (cal.accessRole !== "owner" && cal.accessRole !== "writer") {
        return googleError(403, "You need to have writer access.", "PERMISSION_DENIED");
      }
      const ev = makeEvent(json(ctx));
      if (ev === null) {
        return googleError(400, "Missing end time.", "INVALID_ARGUMENT");
      }
      eventsOf(cal.id).set(ev.id, ev);
      return [200, fmtEvent(cal, ev)];
    }
  }
  m = new RegExp(`^${base}/calendars/([^/]+)/events/([^/]+)$`).exec(path);
  if (m !== null) {
    const cal = calendarOr404(m[1]);
    if (cal === null) return NOT_FOUND;
    const eventId = decodeURIComponent(m[2]);
    const bucket = eventsOf(cal.id);
    const ev = bucket.get(eventId);
    if (ev === void 0) {
      return googleError(404, "Not Found", "NOT_FOUND");
    }
    if (method === "GET") return [200, fmtEvent(cal, ev)];
    if (cal.accessRole !== "owner" && cal.accessRole !== "writer") {
      return googleError(403, "You need to have writer access.", "PERMISSION_DENIED");
    }
    if (method === "PATCH") {
      const body = json(ctx);
      const times = readEventTimes(body, ev);
      if (times === null) return googleError(400, "Missing end time.", "INVALID_ARGUMENT");
      const next = {
        ...ev,
        summary: body.summary ?? ev.summary,
        description: body.description ?? ev.description,
        location: body.location ?? ev.location,
        start: times.start,
        end: times.end,
        updated: state.now()
      };
      bucket.set(eventId, next);
      return [200, fmtEvent(cal, next)];
    }
    if (method === "DELETE") {
      bucket.delete(eventId);
      return [204, null];
    }
  }
  if (path === `${base}/freeBusy` && method === "POST") {
    const body = json(ctx);
    const timeMin = String(body.timeMin ?? "");
    const timeMax = String(body.timeMax ?? "");
    const lo = Date.parse(timeMin);
    const hi = Date.parse(timeMax);
    const items = body.items ?? [];
    const calendars = {};
    for (const item of items) {
      const cal = calendarOr404(String(item.id ?? ""));
      if (cal === null) {
        calendars[String(item.id ?? "")] = {
          errors: [{ domain: "global", reason: "notFound" }]
        };
        continue;
      }
      const busy = [...eventsOf(cal.id).values()].filter((ev) => ev.status !== "cancelled").filter(
        (ev) => eventEndMs(ev, cal.timeZone) > lo && eventStartMs(ev, cal.timeZone) < hi
      ).sort((a, b) => eventStartMs(a, cal.timeZone) - eventStartMs(b, cal.timeZone)).map((ev) => ({
        start: new Date(eventStartMs(ev, cal.timeZone)).toISOString(),
        end: new Date(eventEndMs(ev, cal.timeZone)).toISOString()
      }));
      calendars[String(item.id ?? "")] = { busy };
    }
    return [200, { kind: "calendar#freeBusy", timeMin, timeMax, calendars }];
  }
  return null;
}
function fmtForm(form) {
  return {
    formId: form.formId,
    info: {
      title: form.title,
      documentTitle: form.documentTitle,
      ...form.description === void 0 ? {} : { description: form.description }
    },
    items: form.items,
    revisionId: String(form.revision),
    responderUri: `https://docs.google.com/forms/d/e/${form.formId}/viewform`
  };
}
function applyFormRequest(form, req) {
  const createItem = req.createItem;
  if (createItem?.item !== void 0) {
    const item = {
      itemId: state.nextId("item"),
      ...createItem.item
    };
    const at = createItem.location?.index ?? form.items.length;
    form.items.splice(at, 0, item);
    return;
  }
  const updateInfo = req.updateFormInfo;
  if (updateInfo?.info !== void 0) {
    if (updateInfo.info.title !== void 0) form.title = updateInfo.info.title;
    if (updateInfo.info.description !== void 0) form.description = updateInfo.info.description;
  }
}
function routeForms(ctx) {
  const { method, path } = ctx;
  if (path === "/v1/forms" && method === "POST") {
    const body = json(ctx);
    const info = body.info ?? {};
    const title = info.title ?? "Untitled form";
    const item = createDriveItem(
      info.documentTitle ?? title,
      FORM_MIME,
      [],
      Buffer.alloc(0),
      state.nextId("form")
    );
    const form = {
      formId: item.id,
      title,
      documentTitle: info.documentTitle ?? title,
      items: [],
      responses: [],
      revision: 1
    };
    state.forms.set(form.formId, form);
    return [200, fmtForm(form)];
  }
  let m = /^\/v1\/forms\/([^/:]+)$/.exec(path);
  if (m !== null && method === "GET") {
    const form = state.forms.get(m[1]);
    if (form === void 0) return NOT_FOUND;
    return [200, fmtForm(form)];
  }
  m = /^\/v1\/forms\/([^/:]+):batchUpdate$/.exec(path);
  if (m !== null && method === "POST") {
    const form = state.forms.get(m[1]);
    if (form === void 0) return NOT_FOUND;
    const body = json(ctx);
    const requests = body.requests ?? [];
    for (const req of requests) applyFormRequest(form, req);
    form.revision += 1;
    touchNative(form.formId);
    return [200, { form: fmtForm(form), replies: requests.map(() => ({})) }];
  }
  m = /^\/v1\/forms\/([^/:]+)\/responses$/.exec(path);
  if (m !== null && method === "GET") {
    const form = state.forms.get(m[1]);
    if (form === void 0) return NOT_FOUND;
    return [200, { responses: form.responses }];
  }
  m = /^\/v1\/forms\/([^/:]+)\/responses\/([^/:]+)$/.exec(path);
  if (m !== null && method === "GET") {
    const form = state.forms.get(m[1]);
    const found = form?.responses.find((r) => r.responseId === m?.[2]);
    if (found === void 0) return NOT_FOUND;
    return [200, found];
  }
  return null;
}
function rangeLabelFor(range, requested) {
  if (requested.includes("!")) return requested;
  return `${range.tab.title}!A1:Z1000`;
}
function startServer(port) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      let status;
      let body;
      let contentType;
      try {
        ;
        [status, body, contentType] = route({
          method: req.method ?? "GET",
          path: url.pathname,
          query: url.searchParams,
          body: Buffer.concat(chunks),
          contentType: req.headers["content-type"] ?? "",
          range: req.headers.range ?? ""
        });
      } catch (err) {
        console.error("gws_server: unhandled route error", err);
        status = 500;
        body = { error: { code: 500, message: "internal error", status: "INTERNAL" } };
      }
      if (body === null) {
        res.writeHead(status);
        res.end();
        return;
      }
      if (Buffer.isBuffer(body)) {
        res.writeHead(status, { "Content-Type": contentType ?? "application/octet-stream" });
        res.end(body);
        return;
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, BIND_HOST, () => resolve(server));
  });
}
const isMain = process.argv[1] !== void 0 && process.argv[1].endsWith("gws_server.ts");
if (isMain) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 19999;
  void startServer(port).then(() => {
    console.log(`GWS_URL=http://127.0.0.1:${String(port)}`);
  });
}
export {
  startServer
};
