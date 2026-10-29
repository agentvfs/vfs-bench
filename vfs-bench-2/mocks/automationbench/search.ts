/**
 * `api_search` (tools/api/search.py) and `base64_encode` (tools/api/encode.py).
 *
 * The corpus is upstream's: `data/endpoints.json` holds the index lines as
 * `_regenerate_index` builds them from the API schemas, and each endpoint as
 * a result shows it (harbor/automationbench.py writes it). The ranking is
 * upstream's `BM25Scorer` (utils/bm25.py), statement for statement.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Py, type PyDict, PyError, dumps, loads, slice } from './py.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

interface Corpus {
  lines: string[]
  endpoints: Record<string, PyDict>
}

let corpus: { lines: string[]; endpoints: Record<string, PyDict>; scorer: BM25 } | undefined

function load() {
  if (corpus === undefined) {
    const data = loads(readFileSync(join(HERE, 'data', 'endpoints.json'), 'utf8')) as unknown as Corpus
    corpus = { ...data, scorer: new BM25(data.lines) }
  }
  return corpus
}

/** `tokenize(text)`: lowercase runs of `[a-z0-9]`, `_` a separator. */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/_/g, ' ').match(/[a-z0-9]+/g) ?? []
}

class BM25 {
  private readonly docs: string[][]
  private readonly avgdl: number
  private readonly idf = new Map<string, number>()
  private readonly k1: number
  private readonly b: number
  constructor(lines: string[], k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
    this.docs = lines.map(tokenize)
    const n = this.docs.length
    this.avgdl = n ? this.docs.reduce((s, d) => s + d.length, 0) / n : 1.0
    const df = new Map<string, number>()
    for (const doc of this.docs) for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1)
    for (const [term, freq] of df) this.idf.set(term, Math.log((n - freq + 0.5) / (freq + 0.5) + 1))
  }
  scores(query: string): number[] {
    const terms = tokenize(query)
    return this.docs.map((doc) => {
      const dl = doc.length
      let score = 0.0
      for (const term of terms) {
        const idf = this.idf.get(term) ?? 0.0
        if (idf === 0.0) continue
        let tf = 0
        for (const t of doc) if (t === term) tf++
        score += (idf * (tf * (this.k1 + 1))) / (tf + this.k1 * (1 - this.b + (this.b * dl) / this.avgdl))
      }
      return score
    })
  }
  topK(query: string, k: number): number[] {
    const scored = this.scores(query)
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s > 0)
    scored.sort((x, y) => (y[0] > x[0] ? 1 : y[0] < x[0] ? -1 : 0) || x[1] - y[1])
    return slice(scored, null, k).map(([, i]) => i)
  }
}

/** `api_search(query, top_k=5)`. */
export function apiSearch(query: unknown, topK: unknown = 5): string {
  if (typeof query !== 'string') throw new PyError('AttributeError', `'${query === null ? 'NoneType' : typeof query}' object has no attribute 'lower'`)
  if (typeof topK !== 'number') throw new PyError('TypeError', `can't multiply sequence by non-int of type 'int'`)
  const { lines, endpoints, scorer } = load()
  const results: Py[] = []
  const seen = new Set<string>()
  for (const i of scorer.topK(query, topK * 3)) {
    const parts = lines[i]!.split('\t')
    if (parts.length < 2) continue
    const id = parts[1]!
    if (seen.has(id) || endpoints[id] === undefined) continue
    seen.add(id)
    results.push(endpoints[id]!)
    if (results.length >= topK) break
  }
  return dumps({ results, count: results.length })
}

/** `base64_encode(text)`: `base64.urlsafe_b64encode(text.encode("utf-8"))`, padded. */
export function base64Encode(text: unknown): string {
  if (typeof text !== 'string') throw new PyError('AttributeError', `'${typeof text}' object has no attribute 'encode'`)
  if (/[\ud800-\udfff]/.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) {
    throw new PyError('UnicodeEncodeError', "'utf-8' codec can't encode character: surrogates not allowed")
  }
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}
