/**
 * The UI's HTTP API, as a Connect-style middleware so Vite's dev
 * server and `main.ts` mount the same thing.
 *
 *   GET  /api/configs              the dataset configs under harbor/
 *   GET  /api/jobs                 every job under state/harbor/*
 *   GET  /api/job?id=<dir>/<name>  one job's cells, live terminals and status
 *   GET  /api/tasks?dataset=        a dataset's tasks, as their directories describe them
 *   POST /api/run     {config, agent, model, concurrency, attempts, filter}
 *   POST /api/stop    {id}
 *   POST /api/stop-trial {trial}
 *   POST /api/resume  {id}
 *   POST /api/retry   {id, tasks}
 *   POST /api/delete  {id}           the run's directory and its retries', for good
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { Harbor } from './harbor.ts'

/** The vfs-bench-2 checkout the UI drives: VFSBENCH_ROOT, else its parent. */
export function rootDir(): string {
  return resolve(process.env.VFSBENCH_ROOT ?? new URL('../..', import.meta.url).pathname)
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

export function api(harbor = new Harbor(rootDir())) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://ui')
    if (!url.pathname.startsWith('/api/')) return next()
    // Only this machine's own pages may start or stop runs.
    const origin = req.headers.origin
    if (req.method === 'POST' && origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return send(res, 403, { error: 'Forbidden origin' })
    try {
      const route = `${req.method} ${url.pathname}`
      if (route === 'GET /api/configs') return send(res, 200, await harbor.configs())
      if (route === 'GET /api/jobs') return send(res, 200, await harbor.jobs())
      if (route === 'GET /api/job') return send(res, 200, await harbor.detail(url.searchParams.get('id') ?? ''))
      if (route === 'GET /api/tasks') return send(res, 200, await harbor.tasks(url.searchParams.get('dataset') ?? ''))
      if (route === 'POST /api/run') return send(res, 200, { id: await harbor.run(await body(req)) })
      if (route === 'POST /api/stop') return send(res, 200, await harbor.stop((await body(req)).id))
      if (route === 'POST /api/stop-trial') return send(res, 200, await harbor.stopTrial((await body(req)).trial))
      if (route === 'POST /api/resume') return send(res, 200, await harbor.resume((await body(req)).id))
      if (route === 'POST /api/delete') return send(res, 200, await harbor.remove((await body(req)).id))
      if (route === 'POST /api/retry') {
        const { id, tasks } = await body(req)
        return send(res, 200, { id: await harbor.retry(id, tasks) })
      }
      send(res, 404, { error: 'Not found' })
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
