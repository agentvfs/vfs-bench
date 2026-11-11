/**
 * Upstream's Harbor verifier (`harbor/runtime/verify.py`) and the judge it
 * runs (`eval/judge.py`), for deliverables Mirage reads as text.
 *
 * The judge reads every file under /workspace/output into one text, then
 * asks the judge model about each rubric item in turn; an item scores its
 * weight when the model passes all its criteria, and the reward is the
 * scored share of the total weight. Where upstream's verifier refuses to
 * publish a reward (a judge that failed or answered off-schema, output that
 * reads as empty), this throws, so the trial has no reward rather than 0.
 *
 * Only text deliverables are read: a .xlsx, .docx, .pdf, .pptx, notebook or
 * database, which upstream reads with openpyxl and LibreOffice, mammoth,
 * pdfplumber, python-pptx or sqlite3, throws (the ported tasks ask for none).
 */
import { createHash } from 'node:crypto'
import { type Context, type Grade, GradeError, round, strip } from '../../../workspace/grader.ts'

const OUTPUT = '/workspace/output'
const RUBRICS = '/tests/RUBRICS.json'
const MAX_CHARS_PER_FILE = 200_000
const DEFAULT_API_BASE = 'https://api.x.ai/v1'
const DEFAULT_MODEL = 'grok-4.3'
const TEXT = new Set([
  'txt', 'md', 'csv', 'py', 'json', 'sh', 'log', 'xml', 'html', 'css', 'js', 'ts', 'yaml', 'yml', 'ini', 'cfg', 'conf',
  'sql', 'rules', 'geojson',
])
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp'])
const VISION_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const MAX_VISION_IMAGES = 8
const VISUAL = /\b(plot|figure|visualization|visualisation|visualize|visualise|heatmap|histogram|scatter ?plot|biplot|diagram|q[- ]?q)\b/i
const SYSTEM = 'You are an evaluation judge. You must return valid JSON only, with no markdown formatting or extra text.'
const PARSED = ['direct_json', 'markdown_fence', 'first_last_brace', 'regex_extract']

type Rubric = { rubric?: string; weight?: number; criterion?: string | string[] }
type Result = { index: number; rubric: string; weight: number; result: Record<string, any> }

/** A file's extension as `Path.suffix.lower().lstrip(".")` gives it. */
function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

/** `sorted(output_dir.rglob("*"))`: Path order compares part by part. */
function byParts(a: string, b: string): number {
  const x = a.split('/'),
    y = b.split('/')
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1
  return x.length - y.length
}

/** Every file under the output directory, relative to it, in rglob order. */
function outputs(c: Context): string[] {
  return c.input.files
    .filter((f) => f.startsWith(OUTPUT + '/'))
    .map((f) => f.slice(OUTPUT.length + 1))
    .sort(byParts)
}

/** `convert_file_to_text`, for the files Mirage reads. */
function fileText(c: Context, path: string): string {
  const ext = extension(path)
  // `read_text(encoding="utf-8", errors="replace")`, with its universal newlines.
  if (TEXT.has(ext)) return new TextDecoder('utf-8').decode(c.bytes(`${OUTPUT}/${path}`)).replace(/\r\n?/g, '\n')
  if (IMAGES.has(ext)) return `[Image file: ${path.slice(path.lastIndexOf('/') + 1)} — cannot extract text content]`
  if (['xlsx', 'xls', 'docx', 'pdf', 'db', 'sqlite', 'sqlite3', 'pptx', 'ipynb'].includes(ext))
    throw new Error(`${path}: a .${ext} deliverable is not read here; upstream reads it with its own libraries`)
  return `[Binary or unsupported file type: ${ext} — ${path.slice(path.lastIndexOf('/') + 1)}]`
}

/** `extract_all_file_contents`: each file's text under its name, each cut at 200,000 characters. */
function fileContents(c: Context, files: string[]): string {
  return files
    .map((path) => {
      let content = fileText(c, path)
      const chars = Array.from(content)
      if (chars.length > MAX_CHARS_PER_FILE)
        content = chars.slice(0, MAX_CHARS_PER_FILE).join('') + `\n... [Content truncated at ${MAX_CHARS_PER_FILE} characters]`
      return `=== FILE: ${path} ===\n${content}\n`
    })
    .join('\n')
}

/** `collect_image_attachments`: the output's images, deduplicated by content, at most eight. */
function images(c: Context, files: string[]): [string, string][] {
  const seen = new Set<string>(),
    out: [string, string][] = []
  for (const path of files) {
    const mime = VISION_MIME[extension(path)]
    if (mime === undefined) continue
    const bytes = c.bytes(`${OUTPUT}/${path}`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (seen.has(digest)) continue
    seen.add(digest)
    out.push([path, `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`])
    if (out.length >= MAX_VISION_IMAGES) break
  }
  return out
}

const criteriaOf = (rubric: Rubric): string[] =>
  typeof rubric.criterion === 'string' ? [rubric.criterion] : [...(rubric.criterion ?? [])]

/** Python's `bool()` of a JSON value. */
const truthy = (v: unknown): boolean =>
  !(v === null || v === undefined || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) ||
    (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length))

/** `_remove_json_trailing_commas`: commas closing a container, outside strings. */
function dropTrailingCommas(content: string): string {
  let out = '',
    inString = false,
    escaped = false
  const ws = ' \t\r\n'
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === ',') {
      let next = i + 1
      while (next < content.length && ws.includes(content[next]!)) next++
      let prev = i - 1
      while (prev >= 0 && ws.includes(content[prev]!)) prev--
      if (next < content.length && ']}'.includes(content[next]!) && prev >= 0 && !'[{,:'.includes(content[prev]!)) continue
    }
    out += ch
  }
  return out
}

/** `parse_judge_json`: the reply's JSON, and which of upstream's recoveries found it. */
function parseReply(content: string): [unknown, string] {
  const candidates: [string, string][] = [[content, 'direct_json']]
  const tryParse = (text: string): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch {
      return { ok: false }
    }
  }
  let r = tryParse(content)
  if (r.ok) return [r.value, 'direct_json']
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/.exec(content)
  if (fence) {
    const inner = strip(fence[1]!)
    candidates.push([inner, 'markdown_fence'])
    if ((r = tryParse(inner)).ok) return [r.value, 'markdown_fence']
  }
  const first = content.indexOf('{'),
    last = content.lastIndexOf('}')
  if (first !== -1 && last > first) {
    const inner = content.slice(first, last + 1)
    candidates.push([inner, 'first_last_brace'])
    if ((r = tryParse(inner)).ok) return [r.value, 'first_last_brace']
  }
  for (const m of [...content.matchAll(/\{[\s\S]*?"criteria_results"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/g)].reverse()) {
    candidates.push([m[0], 'regex_extract'])
    if ((r = tryParse(m[0])).ok) return [r.value, 'regex_extract']
  }
  for (const [candidate, status] of candidates) {
    const recovered = dropTrailingCommas(candidate)
    if (recovered === candidate) continue
    if ((r = tryParse(recovered)).ok) return [r.value, `${status}_trailing_commas`]
  }
  throw new Error(`Could not extract JSON from response: ${content.slice(0, 500)}`)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One `client.chat.completions.create`: the openai client's own retries
 * (two more on a connection error, a timeout, or a 408, 409, 429 or 5xx,
 * after 0.5 s then 1 s), its error from the rest.
 */
async function complete(apiBase: string, apiKey: string, body: string, timeoutSec: number): Promise<string> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1))
    let response: Response
    try {
      response = await fetch(apiBase.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutSec * 1000),
      })
    } catch (error) {
      last = error
      continue
    }
    const text = await response.text()
    if (response.ok) {
      const content = JSON.parse(text)?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('judge reply has no message content')
      return strip(content)
    }
    last = new Error(`judge HTTP ${response.status}: ${text.slice(0, 200)}`)
    const retry = response.headers.get('x-should-retry')
    if (retry === 'false' || (retry !== 'true' && ![408, 409, 429].includes(response.status) && response.status < 500)) throw last
  }
  throw last
}

/** `judge_rubric`: one item's prompt, the judge's reply, and the item's result from it. */
async function judgeRubric(
  index: number,
  rubric: Rubric,
  contents: string,
  model: string,
  apiBase: string,
  apiKey: string,
  attachments: [string, string][]
): Promise<{ result: Result; debug: Record<string, unknown> }> {
  const text = rubric.rubric ?? ''
  const weight = rubric.weight ?? 0
  const criteria = criteriaOf(rubric)
  const listText = criteria.map((c, i) => `Criterion ${i}: ${c}`).join('\n')
  const needsVision = VISUAL.test(text + ' ' + (Array.isArray(rubric.criterion) ? rubric.criterion.join(' ') : rubric.criterion ?? ''))
  const attached = attachments.length && needsVision ? attachments : []
  const vision = attached.length > 0
  const prompt = `You are an evaluation judge. Your task is to evaluate ALL criteria for a single rubric.

## Rubric Description
${text}

## Criteria to Evaluate (Judge ALL of them)
${listText}

## Output Files Content
The following are the contents of all output files to evaluate:

${contents}

## Evaluation Rules
- Evaluate EACH criterion listed above independently
- For each criterion: determine if it PASSES or FAILS
- Semantic matching is acceptable (you don't need exact wording match)
- Binary judgment for each criterion: PASS or FAIL only
- The rubric passes ONLY if ALL criteria pass

## Output Format
Return your judgment as a JSON object with EXACTLY this structure (no markdown, no extra text):
{
  "criteria_results": [
    {"index": 0, "passed": true/false, "reasoning": "...", "evidence": "..."},
    {"index": 1, "passed": true/false, "reasoning": "...", "evidence": "..."}
  ],
  "rubric_passed": true/false,
  "overall_reasoning": "Summary of why the rubric passed or failed"
}

IMPORTANT:
- criteria_results array must have exactly ${criteria.length} items (one for each criterion)
- rubric_passed should be true ONLY if ALL criteria passed
- Include specific evidence from the output files${vision ? ' and the attached images' : ''}
`
  const user = vision
    ? [
        { type: 'text', text: prompt },
        { type: 'text', text: `\n## Attached Images (${attached.length} file${attached.length !== 1 ? 's' : ''})` },
        ...attached.flatMap(([name, url], i) => [
          { type: 'text', text: `Image ${i + 1}: ${name}` },
          { type: 'image_url', image_url: { url } },
        ]),
      ]
    : prompt
  // The openai client's body as it sends it: its keys in its own order,
  // compact, `temperature` a float as Python writes it.
  const body =
    JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      model,
      max_completion_tokens: 200000,
    }).slice(0, -1) + ',"temperature":0.0}'
  let last: unknown,
    raw = '',
    status = 'failed'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      raw = await complete(apiBase, apiKey, body, 300)
      const [parsed, how] = parseReply(raw)
      status = how
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('reply is not an object')
      const reply = parsed as Record<string, any>
      // `parsed.get("criteria_results", [])`, indexed as Python would: an
      // empty object or string reads as no results, any other non-list raises.
      let given: any = Object.hasOwn(reply, 'criteria_results') ? reply.criteria_results : []
      if (!Array.isArray(given)) {
        const empty = given === '' || (given !== null && typeof given === 'object' && !Object.keys(given).length)
        if (!empty) throw new Error('criteria_results is not a list')
        given = []
      }
      const passed = truthy(reply.rubric_passed ?? false)
      const enriched = criteria.map((criterion, i) => {
        const item = i < given.length ? given[i] : {}
        if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('criterion result is not an object')
        return { index: i, criterion, passed: truthy(item.passed ?? false), reasoning: item.reasoning ?? '', evidence: item.evidence ?? '' }
      })
      return {
        result: {
          index,
          rubric: text,
          weight,
          result: {
            passed,
            score: passed ? weight : 0,
            criteria_count: criteria.length,
            criteria_passed: enriched.filter((e) => e.passed).length,
            criteria_results: enriched,
            overall_reasoning: reply.overall_reasoning ?? '',
          },
        },
        debug: { parse_status: status, api_exit_code: 0, criterion_count: criteria.length, raw_response: raw, reply, vision_used: vision, attached_images: attached.map(([n]) => n) },
      }
    } catch (error) {
      last = error
      if (attempt < 2) await sleep(2000)
    }
  }
  throw last
}

/**
 * `_validate_judge_logs`, for one item: a reply upstream's verifier accepts
 * is an object whose criteria are booleans, one per criterion, with a
 * boolean verdict and a string summary.
 */
function validReply(debug: Record<string, unknown>): boolean {
  const reply = debug.reply as Record<string, any>
  const criteria = reply.criteria_results
  return (
    PARSED.includes(String(debug.parse_status).replace(/_trailing_commas$/, '')) &&
    Array.isArray(criteria) &&
    criteria.length === debug.criterion_count &&
    criteria.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item) && typeof item.passed === 'boolean') &&
    typeof reply.rubric_passed === 'boolean' &&
    typeof reply.overall_reasoning === 'string'
  )
}

/** `build_failed_rubric_result`: an item no judge saw. */
const failed = (index: number, rubric: Rubric, reasoning: string): Result => ({
  index,
  rubric: rubric.rubric ?? '',
  weight: rubric.weight ?? 0,
  result: {
    passed: false,
    score: 0,
    criteria_count: criteriaOf(rubric).length,
    criteria_passed: 0,
    criteria_results: criteriaOf(rubric).map((criterion, i) => ({ index: i, criterion, passed: false, reasoning, evidence: '' })),
    overall_reasoning: reasoning,
  },
})

/** Pool upstream's ten workers: run `jobs` with at most `limit` at once. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++
        out[i] = await jobs[i]!()
      }
    })
  )
  return out
}

/** Upstream's verify.py around judge.py: the reward, or no reward where it publishes none. */
export async function grader(c: Context): Promise<Grade> {
  const payload = c.json(RUBRICS)
  const rubrics: Rubric[] = (payload && typeof payload === 'object' && (payload.rubrics || payload.evaluation_rubrics)) || []
  if (!Array.isArray(rubrics) || !rubrics.length) throw new Error('Rubric file contains no rubrics')
  const env = c.input.env ?? {}
  const files = outputs(c)
  let results: Result[],
    debugs: Record<string, unknown>[] = []
  if (!files.length) {
    results = rubrics.map((r, i) => failed(i, r, 'No output files found in the model output directory.'))
  } else {
    const contents = fileContents(c, files)
    // An output that reads as empty leaves the judge's rubric logs unwritten,
    // which upstream's verifier rejects.
    if (!strip(contents)) throw new Error('Judge produced 0 rubric logs: output files were unreadable or empty after conversion')
    const model = env.JUDGE_MODEL || DEFAULT_MODEL
    const apiBase = env.JUDGE_API_BASE || DEFAULT_API_BASE
    const apiKey = env.JUDGE_API_KEY || ''
    if (!apiKey) throw new Error('No judge API key provided. Set JUDGE_API_KEY.')
    const attachments = images(c, files)
    // Like upstream's executor, every item is judged even when one fails, so
    // the replies already paid for are saved with the failure.
    const judged = await pool(
      rubrics.map(
        (r, i) => () =>
          judgeRubric(i, r, contents, model, apiBase, apiKey, attachments).catch((error) => ({
            result: failed(i, r, `Judge raised an exception: ${error}`),
            debug: { parse_status: 'failed', api_exit_code: 2, criterion_count: criteriaOf(r).length, raw_response: '', error: String(error) },
          }))
      ),
      10
    )
    results = judged.map((j) => j.result)
    debugs = judged.map((j) => j.debug)
    const error = debugs.findIndex((d) => d.api_exit_code !== 0)
    if (error >= 0)
      throw new GradeError(`Judge failed for rubric ${error}: ${debugs[error]!.error}`, { 'judge.json': debugs })
    const invalid = debugs.findIndex((d) => !validReply(d))
    if (invalid >= 0)
      throw new GradeError(`Judge response schema is invalid for rubric ${invalid}`, { 'judge.json': debugs })
  }
  const total = results.reduce((n, r) => n + r.result.score, 0)
  const max = results.reduce((n, r) => n + r.weight, 0)
  const passedCount = results.filter((r) => r.result.passed).length
  const reward = max > 0 ? round(total / max, 4) : 0
  const checks: Grade['checks'] = {
    total_score: total,
    max_score: max,
    normalized_score: reward,
    pass_rate: results.length ? round(passedCount / results.length, 4) : 0,
    passed_count: passedCount,
    total_count: results.length,
  }
  for (const r of results) {
    checks[`rubric_${r.index}_passed`] = r.result.passed ? 1 : 0
    checks[`rubric_${r.index}_score`] = r.result.score
  }
  return {
    score: reward,
    checks,
    rewards: { reward },
    artifacts: { 'judge-details.json': { rubrics: results }, 'judge.json': debugs },
  }
}
