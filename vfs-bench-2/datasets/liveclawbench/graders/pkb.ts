/**
 * What the LLM-judged verifiers share (upstream's `tests/llm_judge.py` and
 * `tests/deterministic_checks.py` of corpus-file-injection,
 * noise-filtering, incremental-update-ctp, vendor-due-diligence-brief and
 * pre-meeting-research-brief): the values of Python's `json` as they read
 * and write them, the judge's client, and their reads of the agent's
 * files, by path, over the verifier's VFS.
 *
 * A Python dict from `json.loads` is a `Map`, in insertion order whatever
 * its keys; an int a number (a bigint past 2^53) and a float a `PyFloat`,
 * so `json.dumps` prints `1.0` where Python does. The judge's prompt is
 * upstream's, byte for byte.
 */
import { PyFloat, reprFloat, reprStr, toFloat } from '../../../workspace/py.ts'
import { type Context, lines, round, strip } from '../../../workspace/grader.ts'

export type Json = null | boolean | number | bigint | PyFloat | string | Json[] | Map<string, Json>
export type Dict = Map<string, Json>

export class JSONDecodeError extends Error {}

/** `json.loads`, as CPython's parser reads: NaN and Infinity, a dict's last value for a key. */
export function loads(text: string): Json {
  let i = 0
  const fail = (what: string): never => {
    throw new JSONDecodeError(`${what} at ${i}`)
  }
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++
  }
  const word = (w: string, v: Json): Json => {
    if (text.startsWith(w, i)) {
      i += w.length
      return v
    }
    return fail('Expecting value')
  }
  const string = (): string => {
    let out = ''
    i++
    for (;;) {
      if (i >= text.length) fail('Unterminated string')
      const ch = text[i]!
      if (ch === '"') {
        i++
        return out
      }
      if (ch === '\\') {
        const e = text[i + 1]
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (e !== undefined && e in simple) {
          out += simple[e]
          i += 2
          continue
        }
        if (e !== 'u' || !/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('Invalid \\escape')
        out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16))
        i += 6
        continue
      }
      if (ch < ' ') fail('Invalid control character')
      out += ch
      i++
    }
  }
  const value = (): Json => {
    ws()
    const ch = text[i]
    if (ch === '{') {
      const dict: Dict = new Map()
      i++
      ws()
      if (text[i] === '}') {
        i++
        return dict
      }
      for (;;) {
        ws()
        if (text[i] !== '"') fail('Expecting property name enclosed in double quotes')
        const key = string()
        ws()
        if (text[i] !== ':') fail("Expecting ':' delimiter")
        i++
        dict.set(key, value())
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return dict
        }
        fail("Expecting ',' delimiter")
      }
    }
    if (ch === '[') {
      const list: Json[] = []
      i++
      ws()
      if (text[i] === ']') {
        i++
        return list
      }
      for (;;) {
        list.push(value())
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return list
        }
        fail("Expecting ',' delimiter")
      }
    }
    if (ch === '"') return string()
    if (ch === 'n') return word('null', null)
    if (ch === 't') return word('true', true)
    if (ch === 'f') return word('false', false)
    if (ch === 'N') return word('NaN', new PyFloat(NaN))
    if (ch === 'I') return word('Infinity', new PyFloat(Infinity))
    if (ch === '-' && text.startsWith('-Infinity', i)) return word('-Infinity', new PyFloat(-Infinity))
    const m = /^(-?(?:0|[1-9]\d*))(\.\d+)?([eE][-+]?\d+)?/.exec(text.slice(i))
    if (!m) return fail('Expecting value')
    i += m[0].length
    if (m[2] || m[3]) return new PyFloat(Number(m[0]))
    const n = BigInt(m[1]!)
    return n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : n
  }
  const result = value()
  ws()
  if (i !== text.length) fail('Extra data')
  return result
}

/** `json.dumps(value, ensure_ascii=False, indent=indent)`. */
export function dumps(value: unknown, indent: number | null = 2): string {
  const quote = (s: string) =>
    '"' +
    s.replace(/[\x00-\x1f\\"]/g, (c) =>
      c === '"' ? '\\"' : c === '\\' ? '\\\\' : c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : c === '\b' ? '\\b' : c === '\f' ? '\\f' : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    ) +
    '"'
  const pad = (level: number) => (indent === null ? '' : '\n' + ' '.repeat(indent * level))
  const [itemSep, keySep] = indent === null ? [', ', ': '] : [',', ': ']
  const float = (v: number) => (Number.isNaN(v) ? 'NaN' : !Number.isFinite(v) ? (v > 0 ? 'Infinity' : '-Infinity') : reprFloat(v))
  const enc = (v: unknown, level: number): string => {
    if (v === null || v === undefined) return 'null'
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (v instanceof PyFloat) return float(v.v)
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : float(v)
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'string') return quote(v)
    const entries: [string, unknown][] | null = v instanceof Map ? [...v.entries()] : Array.isArray(v) ? null : Object.entries(v as object)
    if (entries === null) {
      const list = v as unknown[]
      if (!list.length) return '[]'
      return '[' + pad(level + 1) + list.map((x) => enc(x, level + 1)).join(itemSep + pad(level + 1)) + pad(level) + ']'
    }
    if (!entries.length) return '{}'
    const parts = entries.map(([k, x]) => quote(k) + keySep + enc(x, level + 1))
    return '{' + pad(level + 1) + parts.join(itemSep + pad(level + 1)) + pad(level) + '}'
  }
  return enc(value, 0)
}

export const isDict = (v: unknown): v is Dict => v instanceof Map
export const isList = (v: unknown): v is Json[] => Array.isArray(v)

/** `bool(v)`. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === '' || v === 0 || v === 0n) return false
  if (v instanceof PyFloat) return v.v !== 0
  if (v instanceof Map) return v.size > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** `str(v)`, as an f-string prints it. */
export function str(v: unknown): string {
  return typeof v === 'string' ? v : repr(v)
}

export function repr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (v instanceof PyFloat) return reprFloat(v.v)
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : reprFloat(v)
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string') return reprStr(v)
  if (v instanceof Map) return '{' + [...v.entries()].map(([k, x]) => `${reprStr(k)}: ${repr(x)}`).join(', ') + '}'
  if (Array.isArray(v)) return '[' + v.map(repr).join(', ') + ']'
  return String(v)
}

/** `for item in v`: a list's items, a str's characters, a dict's keys. */
export function iter(v: Json): Json[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return Array.from(v)
  if (v instanceof Map) return [...v.keys()]
  throw new TypeError(`'${typeof v}' object is not iterable`)
}

/** `float(value)`, clamped to [0, 1] and rounded to 4 places; 0.0 where it is no number. */
export function clampScore(value: unknown): PyFloat {
  let n: number
  try {
    n = toFloat(value).v
  } catch {
    return new PyFloat(0)
  }
  const low = n > 0 ? n : 0
  return new PyFloat(round(low < 1 ? low : 1, 4))
}

/** `round(sum(score.get(key, 0.0) * weight for key, weight in rubric.items()), 4)`. */
export function weightedSum(score: Record<string, unknown>, rubric: Dict): PyFloat {
  let total = 0
  for (const [key, weight] of rubric) total += number(score[key] ?? 0) * number(weight)
  return new PyFloat(round(total, 4))
}

/** A Python number's value. */
export function number(v: unknown): number {
  if (v instanceof PyFloat) return v.v
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return Number(v)
  throw new TypeError(`unsupported operand type(s) for *: '${typeof v}'`)
}

// ---------------------------------------------------------------- files

/** `Path.home() / ".openclaw"`: the image's HOME is /home/node. */
export const ROOT = '/home/node/.openclaw'
export const OUT = `${ROOT}/output`
export const WORK = `${ROOT}/workspace`

/** `path.is_file()`. */
export const isFile = (c: Context, path: string) => c.input.files.includes(path)

/** `path.is_dir()`: a directory the verifier staged, or one holding a staged file. */
export const isDir = (c: Context, path: string) =>
  Boolean(c.input.existingPaths?.includes(path)) || c.input.files.some((f) => f.startsWith(path + '/'))

/** `read_text(path)`: its text, or "" where it is no file. */
export const readText = (c: Context, path: string) => (isFile(c, path) ? c.text(path) : '')

/** `load_json(path)`: the dict the file holds, else an empty one. */
export function loadJson(c: Context, path: string): Dict {
  if (!isFile(c, path)) return new Map()
  try {
    const value = loads(c.text(path))
    return isDict(value) ? value : new Map()
  } catch (error) {
    if (error instanceof JSONDecodeError) return new Map()
    throw error
  }
}

/** The entries `Path(dir).glob(pattern)` lists: a directory's own files and directories. */
export function children(c: Context, dir: string): string[] {
  const out = new Set<string>()
  for (const f of [...c.input.files, ...(c.input.existingPaths ?? [])]) {
    if (!f.startsWith(dir + '/')) continue
    out.add(dir + '/' + f.slice(dir.length + 1).split('/')[0]!)
  }
  return [...out].sort()
}

/** `glob.glob(f"{dir}/**\/{name}", recursive=True)`'s files: none hidden, at any depth. */
export function deep(c: Context, dir: string, name: (base: string) => boolean): string[] {
  return c.input.files
    .filter((f) => f.startsWith(dir + '/'))
    .filter((f) => !f.slice(dir.length + 1).split('/').some((part) => part.startsWith('.')))
    .filter((f) => name(f.slice(f.lastIndexOf('/') + 1)))
    .sort()
}

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const dirname = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

/** `PurePath.suffix`, as CPython 3.12 has it: a leading dot is not one, nor a trailing. */
export function suffix(path: string): string {
  const name = basename(path)
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i) : ''
}

/** `PurePath.stem`. */
export function stem(path: string): string {
  const name = basename(path)
  const s = suffix(path)
  return s ? name.slice(0, -s.length) : name
}

/** `(base / rel).resolve()` with no links to follow: `.` and `..` folded. */
export function resolve(base: string, rel: string): string {
  const parts: string[] = []
  for (const part of (rel.startsWith('/') ? rel : base + '/' + rel).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

/** `path.relative_to(root)`, or null where it is not under it. */
export function relative(path: string, root: string): string | null {
  if (path === root) return '.'
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : null
}

/** A file's text from `strip()`, Python's. */
export { lines, strip }

// ---------------------------------------------------------------- the judge

class HTTPError extends Error {
  readonly code: number
  readonly body: string
  constructor(code: number, body: string) {
    super(`HTTP Error ${code}`)
    this.code = code
    this.body = body
  }
}

/** One judge request, as upstream's `post_json` sends it: three tries, none
 * again on a 4xx, 1 s and 2 s apart, 60 s each. */
async function postJson(url: string, payload: unknown, apiKey: string): Promise<Json> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      })
      const body = await response.text()
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) throw new HTTPError(response.status, body)
        last = new HTTPError(response.status, body)
      } else return loads(body)
    } catch (error) {
      if (error instanceof HTTPError) throw error
      last = error
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
  }
  throw last
}

function stripCodeFence(text: string): string {
  text = strip(text)
  if (text.startsWith('```')) {
    let rows = lines(text)
    if (rows.length) rows = rows.slice(1)
    if (rows.length && strip(rows.at(-1)!).startsWith('```')) rows = rows.slice(0, -1)
    text = strip(rows.join('\n'))
  }
  return text
}

/** `parse_json_blob`: the reply's JSON object, or the one between its first `{` and last `}`. */
export function parseJsonBlob(text: string): Dict {
  const cleaned = stripCodeFence(text)
  let payload: Json
  try {
    payload = loads(cleaned)
  } catch (error) {
    if (!(error instanceof JSONDecodeError)) throw error
    const start = cleaned.indexOf('{'),
      end = cleaned.lastIndexOf('}')
    if (start < 0 || end < start) return new Map()
    try {
      payload = loads(cleaned.slice(start, end + 1))
    } catch (inner) {
      if (inner instanceof JSONDecodeError) return new Map()
      throw inner
    }
  }
  return isDict(payload) ? payload : new Map()
}

const get = (d: Json, key: string, fallback: Json = null): Json => {
  if (!isDict(d)) throw new TypeError(`'${typeof d}' object has no attribute 'get'`)
  return d.has(key) ? d.get(key)! : fallback
}

function extractChatText(payload: Json): string {
  const choices = get(payload, 'choices')
  if (isList(choices) && choices.length) {
    const content = get(get(choices[0]!, 'message', new Map()), 'content', '')
    if (typeof content === 'string') return content
    if (isList(content)) {
      const parts: string[] = []
      for (const item of content) {
        const kind = isDict(item) ? item.get('type') : undefined
        if (isDict(item) && (kind === 'text' || kind === 'output_text')) parts.push(str(get(item, 'text', '')))
      }
      return parts.join('\n')
    }
  }
  return ''
}

function extractResponsesText(payload: Json): string {
  const output = get(payload, 'output')
  if (!isList(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!isDict(item)) continue
    for (const content of iter(get(item, 'content', []))) {
      if (!isDict(content)) continue
      if (content.has('text')) parts.push(str(get(content, 'text', '')))
      else if (content.get('type') === 'output_text' || content.get('type') === 'text') parts.push(str(get(content, 'text', '')))
    }
  }
  return parts.filter(Boolean).join('\n')
}

export const DEFAULT_JUDGE_MODEL = 'deepseek-v3.2'

export interface JudgeDebug {
  mode: string
  url: string
  model: string
  raw_response: Json
}

/**
 * `call_judge`: chat completions, then the responses API, each as
 * upstream's sends it; the first reply holding a JSON object is the
 * verdict. Throws `RuntimeError`'s message where neither answers;
 * `unset` is the variant's ending to its missing-variable errors.
 */
export async function callJudge(
  system: string,
  user: string,
  env: Record<string, string>,
  unset = ' for LLM judging'
): Promise<[Dict, JudgeDebug]> {
  const base = env.JUDGE_BASE_URL || ''
  const model = env.JUDGE_MODEL_ID || DEFAULT_JUDGE_MODEL
  const key = env.JUDGE_API_KEY || ''
  if (!base) throw new JudgeFailed(`JUDGE_BASE_URL is not set${unset}`)
  if (!key) throw new JudgeFailed(`JUDGE_API_KEY is not set${unset}`)
  const chat = base.replace(/\/+$/, '') + '/chat/completions'
  const responses = base.replace(/\/+$/, '') + '/responses'
  const attempts: [string, string, unknown, (p: Json) => string][] = [
    [
      'chat_completions',
      chat,
      {
        model,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      extractChatText,
    ],
    [
      'responses',
      responses,
      {
        model,
        temperature: 0,
        max_output_tokens: 1200,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: user }] },
        ],
      },
      extractResponsesText,
    ],
  ]
  const errors: string[] = []
  for (const [mode, url, payload, extract] of attempts) {
    try {
      const raw = await postJson(url, payload, key)
      const parsed = parseJsonBlob(extract(raw))
      if (parsed.size) return [parsed, { mode, url, model, raw_response: raw }]
      errors.push(`${mode}: response did not contain valid JSON`)
    } catch (error) {
      if (error instanceof HTTPError) errors.push(`${mode}: HTTP ${error.code} ${error.body}`)
      else errors.push(`${mode}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new JudgeFailed('LLM judge request failed: ' + errors.join(' | '))
}

/** The `RuntimeError` upstream's `call_judge` raises. */
export class JudgeFailed extends Error {}

/** A verdict's dimension, as `judge_payload.get(name)` gives it to `clamp_score`. */
export const verdict = (payload: Dict, name: string) => clampScore(payload.get(name) ?? null)

/** A value as JSON the verifier can save: dicts as objects, floats as numbers. */
export function plain(v: unknown): unknown {
  if (v instanceof PyFloat) return Number.isFinite(v.v) ? v.v : null
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, plain(x)]))
  if (Array.isArray(v)) return v.map(plain)
  return v
}

/** A score's numbers for Harbor's reward.json; the rest go to reward_details.json. */
export function split(score: Record<string, unknown>): [Record<string, number>, Record<string, unknown>] {
  const rewards: Record<string, number> = {},
    details: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(score)) {
    if (v instanceof PyFloat || typeof v === 'number' || typeof v === 'boolean') rewards[k] = number(v)
    else details[k] = plain(v)
  }
  return [rewards, details]
}
