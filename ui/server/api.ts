/**
 * The UI's HTTP API, as a Connect-style middleware so Vite's dev
 * server and `main.ts` mount the same thing.
 *
 *   GET  /api/configs              the dataset configs under harbor/
 *   GET  /api/jobs                 every job in the runs folder
 *   GET  /api/job?id=<dir>/<name>  one job's cells, live terminals and status
 *   GET  /api/tasks?dataset=        a dataset's tasks, as their directories describe them
 *   GET  /api/settings             the folders in use, their defaults, and what is in them
 *   POST /api/settings {benchmark, runs}  change them ('' for the default)
 *   POST /api/run     {config, agent, model, concurrency, attempts, filter}
 *   POST /api/stop    {id}
 *   POST /api/stop-trial {trial}
 *   POST /api/resume  {id}
 *   POST /api/retry   {id, tasks}
 *   POST /api/delete  {id}           the run's directory and its retries', for good
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Harbor } from './harbor.ts'

/** Where the UI keeps its settings: beside it, gitignored. */
const SETTINGS = new URL('../settings.json', import.meta.url).pathname

export interface Settings {
  /** The vfs-bench-2 checkout: its harbor/ configs and tasks. '' for the default. */
  benchmark: string
  /** Where Harbor's jobs go and are read from. '' for the default. */
  runs: string
}

/** The benchmark folder when none is set: VFSBENCH_ROOT, else vfs-bench-2 beside the UI. */
function defaultBenchmark(): string {
  return resolve(process.env.VFSBENCH_ROOT ?? new URL('../../vfs-bench-2', import.meta.url).pathname)
}

async function readSettings(): Promise<Settings> {
  try {
    const s = JSON.parse(await readFile(SETTINGS, 'utf8'))
    return { benchmark: String(s.benchmark ?? ''), runs: String(s.runs ?? '') }
  } catch {
    return { benchmark: '', runs: '' }
  }
}

/** The folders a setting resolves to. */
function folders(s: Settings): { benchmark: string; runs: string } {
  const benchmark = s.benchmark ? resolve(s.benchmark) : defaultBenchmark()
  return { benchmark, runs: s.runs ? resolve(s.runs) : join(benchmark, 'state', 'harbor') }
}

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory()

/** Refuse folders the UI could not work in, before they are saved. */
async function check(benchmark: string, runs: string) {
  if (!isDir(benchmark)) throw new Error(`No folder ${benchmark}`)
  const yaml = (await readdir(join(benchmark, 'harbor')).catch(() => [] as string[])).filter((n) => n.endsWith('.yaml'))
  if (!yaml.length) throw new Error(`${benchmark} has no harbor/*.yaml configs; is it a vfs-bench-2 checkout?`)
  if (!isDir(runs)) throw new Error(`No folder ${runs}`)
}

/** The benchmark folder `main.ts` reports at start. */
export async function rootDir(): Promise<string> {
  return folders(await readSettings()).benchmark
}

async function body(req: IncomingMessage): Promise<any> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) : {}
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(value ?? null))
}

export function api() {
  let harbor: Promise<Harbor> = readSettings().then((s) => {
    const f = folders(s)
    return new Harbor(f.benchmark, f.runs)
  })

  const settings = async () => {
    const saved = await readSettings()
    const h = await harbor
    return {
      ...saved,
      defaultBenchmark: defaultBenchmark(),
      defaultRuns: join(h.root, 'state', 'harbor'),
      inUse: { benchmark: h.root, runs: h.jobsRoot },
      datasets: new Set((await h.configs()).map((c) => c.dataset)).size,
      jobs: (await h.jobs()).length,
    }
  }

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://ui')
    if (!url.pathname.startsWith('/api/')) return next()
    // Only this machine's own pages may start or stop runs.
    const origin = req.headers.origin
    if (req.method === 'POST' && origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return send(res, 403, { error: 'Forbidden origin' })
    try {
      const route = `${req.method} ${url.pathname}`
      if (route === 'GET /api/settings') return send(res, 200, await settings())
      if (route === 'POST /api/settings') {
        const given = await body(req)
        const next: Settings = { benchmark: String(given.benchmark ?? '').trim(), runs: String(given.runs ?? '').trim() }
        const f = folders(next)
        await check(f.benchmark, f.runs)
        if ((await harbor).busy) throw new Error('Runs this UI started are still going; stop them first')
        await writeFile(SETTINGS, JSON.stringify(next, null, 2) + '\n')
        harbor = Promise.resolve(new Harbor(f.benchmark, f.runs))
        return send(res, 200, await settings())
      }
      const h = await harbor
      if (route === 'GET /api/configs') return send(res, 200, await h.configs())
      if (route === 'GET /api/jobs') return send(res, 200, await h.jobs())
      if (route === 'GET /api/job') return send(res, 200, await h.detail(url.searchParams.get('id') ?? ''))
      if (route === 'GET /api/tasks') return send(res, 200, await h.tasks(url.searchParams.get('dataset') ?? ''))
      if (route === 'POST /api/run') return send(res, 200, { id: await h.run(await body(req)) })
      if (route === 'POST /api/stop') return send(res, 200, await h.stop((await body(req)).id))
      if (route === 'POST /api/stop-trial') return send(res, 200, await h.stopTrial((await body(req)).trial))
      if (route === 'POST /api/resume') return send(res, 200, await h.resume((await body(req)).id))
      if (route === 'POST /api/delete') return send(res, 200, await h.remove((await body(req)).id))
      if (route === 'POST /api/retry') {
        const { id, tasks } = await body(req)
        return send(res, 200, { id: await h.retry(id, tasks) })
      }
      send(res, 404, { error: 'Not found' })
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
