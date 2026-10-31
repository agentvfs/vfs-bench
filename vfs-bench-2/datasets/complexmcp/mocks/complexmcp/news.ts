/**
 * LightNews (`software/LightNews/news.py`): 40 to 60 of each section's
 * corpus stories, stamped with LightSystem's past times, and the app's
 * read-only tools, statement for statement.
 */
import { type Os, PyError, corpus, slice, uuid } from './common.ts'
import { fromIso } from '../../../../workspace/py.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, failed, ok } from './tool.ts'

interface NewsItem {
  nid: string
  timestamp: string
  title: string
  abstract: string
  content: string
}

export interface NewsData {
  sections: string[]
  news: Record<string, NewsItem[]>
  rng: RandomState
}

const FILES: Record<string, string> = {
  'Town Updates': 'town-updates.yaml',
  'School & Kids': 'school-kids.yaml',
  'Events & Happenings': 'events-happenings.yaml',
  'Local Business': 'local-business.yaml',
  'Public Safety': 'public-safety.yaml',
  Sports: 'sports.yaml',
}

export class NewsSession {
  d: NewsData
  rng: PyRandom
  byId: Map<string, NewsItem>

  constructor(d: NewsData) {
    this.d = d
    this.rng = PyRandom.from(d.rng)
    this.byId = new Map(Object.values(d.news).flat().map((n) => [n.nid, n]))
  }

  /** `NewsSession(seed, os_cfg)`. */
  static async create(seed: number, os: Os): Promise<NewsSession> {
    const rng = new PyRandom(seed)
    const news: Record<string, NewsItem[]> = {}
    for (const [section, file] of Object.entries(FILES)) {
      const list = corpus<{ title: string; abstract: string; content: string }[]>('LightNews', file)
      const count = rng.randint(40, 60)
      const picked = rng.sample(list, count)
      const stamps = await os.genPast(2025, count)
      news[section] = stamps.slice(0, picked.length).map((timestamp, i) => ({
        nid: `news_${uuid(rng)}`,
        timestamp,
        title: picked[i]!.title,
        abstract: picked[i]!.abstract,
        content: picked[i]!.content,
      }))
    }
    return new NewsSession({ sections: Object.keys(FILES), news, rng: rng.getstate() })
  }

  data(): NewsData {
    return { ...this.d, rng: this.rng.getstate() }
  }
}

/** `datetime.fromisoformat(s)`, or the ValueError it raises. */
function iso(s: string) {
  const t = fromIso(s)
  if (t === null) throw new PyError(`Invalid isoformat string: '${s}'`)
  return t
}

/** `a < b` for two datetimes, which Python refuses between a naive and an aware one. */
function before(a: { t: number; aware: boolean }, b: { t: number; aware: boolean }): boolean {
  if (a.aware !== b.aware) throw new PyError("can't compare offset-naive and offset-aware datetimes")
  return a.t < b.t
}

const tools: Tools<NewsSession> = {
  list_all_sections: { params: [], run: async (s) => ok(s.d.sections) },
  get_details: {
    params: [['nid', 'str']],
    run: async (s, { nid }) => {
      const n = s.byId.get(nid)
      return n ? ok({ ...n }) : failed(`News with ID=${nid} not found`)
    },
  },
  get_last_k_news: {
    params: [['section', 'str'], ['k', 'int']],
    run: async (s, { section, k }) => {
      if (!s.d.sections.includes(section)) return failed(`Section '${section}' not found`)
      return ok(slice(s.d.news[section]!, -k).map((n) => ({ nid: n.nid, title: n.title, timestamp: n.timestamp, abstract: n.abstract })))
    },
  },
  search: {
    params: [['section', 'str'], ['query', 'str'], ['maxn', 'int'], ['begin_date', 'str|None', null], ['end_date', 'str|None', null]],
    run: async (s, { section, query, maxn, begin_date, end_date }) => {
      if (!s.d.sections.includes(section)) return failed(`Section '${section}' not found`)
      const begin = begin_date ? iso(begin_date) : null
      const end = end_date ? iso(end_date) : null
      const q = (query as string).toLowerCase()
      const results = []
      for (const n of [...s.d.news[section]!].reverse()) {
        const t = iso(n.timestamp)
        if (begin && before(t, begin)) continue
        if (end && before(end, t)) continue
        if (n.title.toLowerCase().includes(q) || n.abstract.toLowerCase().includes(q)) {
          results.push({ nid: n.nid, timestamp: n.timestamp, title: n.title, abstract: n.abstract })
          if (results.length >= maxn) break
        }
      }
      return ok(results)
    },
  },
  get_news_url: { params: [['nid', 'str']], run: async (_s, { nid }) => ok(`light://news?nid=${nid}`) },
}

export const LightNews: App<NewsSession, NewsData> = {
  name: 'LightNews',
  tools,
  load: (data) => new NewsSession(data),
  save: (s) => s.data(),
  sessionDict: () => ({}),
}
