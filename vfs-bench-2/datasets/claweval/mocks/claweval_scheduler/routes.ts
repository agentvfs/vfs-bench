/**
 * The scheduler fake's routes: upstream's `server.py`, each statement kept,
 * over the run's lists. `jobs` is the fixture's jobs; `created_jobs`,
 * `updated_jobs` and `deleted_jobs` are the copies upstream keeps of each
 * create, update and delete.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow, save } from '../claweval/store.ts'
import type { Dict, Json } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { status: opt(null), enabled: opt(null), tag: opt(null) }
const GET = { job_id: REQUIRED }
const CREATE = {
  name: REQUIRED,
  cron_expression: REQUIRED,
  action: REQUIRED,
  enabled: opt(true),
  tags: opt(null),
  created_by: opt(null),
}
const UPDATE = {
  job_id: REQUIRED,
  enabled: opt(null),
  cron_expression: opt(null),
  name: opt(null),
  action: opt(null),
  tags: opt(null),
}
const DELETE = { job_id: REQUIRED }
const HISTORY = { job_id: REQUIRED, limit: opt(10) }

const copy = (j: Dict): Dict => structuredClone(j)

/** `dict.get(key, default)`. */
const get = (d: Dict, key: string, fallback: Json = null): Json => (key in d ? d[key]! : fallback)

/** Python's `item in container`, for a list or a string. */
function contains(container: Json, item: Json): boolean {
  if (typeof container === 'string') return typeof item === 'string' && container.includes(item)
  return Array.isArray(container) && container.some((x) => x === item)
}

async function listJobs(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const j of await load(ctx.db, 'jobs')) {
    if (req.status && req.status !== 'all' && get(j, 'last_status') !== req.status) continue
    if (req.enabled !== null && get(j, 'enabled') !== req.enabled) continue
    if (req.tag && !contains(get(j, 'tags', []), req.tag!)) continue
    results.push({
      job_id: j.job_id!,
      name: j.name!,
      cron_expression: j.cron_expression!,
      enabled: j.enabled!,
      last_status: get(j, 'last_status'),
      last_run: get(j, 'last_run'),
      next_run: get(j, 'next_run'),
      tags: get(j, 'tags', []),
    })
  }
  const resp = { jobs: results, total: results.length }
  await logCall(ctx, '/scheduler/jobs', req, resp)
  return ok(resp)
}

async function getJob(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const j of await load(ctx.db, 'jobs')) {
    if (j.job_id === req.job_id) {
      const resp = copy(j)
      await logCall(ctx, '/scheduler/jobs/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Job ${String(req.job_id)} not found` }
  await logCall(ctx, '/scheduler/jobs/get', req, resp)
  return ok(resp)
}

async function createJob(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, CREATE)
  if (isReply(req)) return req
  const jobs = await load(ctx.db, 'jobs')
  const newId = `JOB-${String(jobs.length + 1).padStart(3, '0')}`
  const job: Dict = {
    job_id: newId,
    name: req.name!,
    cron_expression: req.cron_expression!,
    action: req.action!,
    enabled: req.enabled!,
    last_run: null,
    next_run: null,
    last_status: null,
    created_by: req.created_by!,
    tags: req.tags || [],
    created_at: pyNow(ctx),
    execution_history: [],
  }
  await append(ctx.db, 'jobs', job)
  await append(ctx.db, 'created_jobs', copy(job))
  const resp = { status: 'created', job: copy(job) }
  await logCall(ctx, '/scheduler/jobs/create', req, resp)
  return ok(resp)
}

async function updateJob(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, UPDATE)
  if (isReply(req)) return req
  const jobs = await load(ctx.db, 'jobs')
  for (const j of jobs) {
    if (j.job_id === req.job_id) {
      if (req.enabled !== null) j.enabled = req.enabled!
      if (req.cron_expression !== null) j.cron_expression = req.cron_expression!
      if (req.name !== null) j.name = req.name!
      if (req.action !== null) j.action = req.action!
      if (req.tags !== null) j.tags = req.tags!
      await save(ctx.db, 'jobs', jobs)
      const updated = copy(j)
      await append(ctx.db, 'updated_jobs', updated)
      const resp = { status: 'updated', job: updated }
      await logCall(ctx, '/scheduler/jobs/update', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Job ${String(req.job_id)} not found` }
  await logCall(ctx, '/scheduler/jobs/update', req, resp)
  return ok(resp)
}

async function deleteJob(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, DELETE)
  if (isReply(req)) return req
  const jobs = await load(ctx.db, 'jobs')
  for (const [i, j] of jobs.entries()) {
    if (j.job_id === req.job_id) {
      const [removed] = jobs.splice(i, 1) as [Dict]
      await save(ctx.db, 'jobs', jobs)
      await append(ctx.db, 'deleted_jobs', removed)
      const resp = { status: 'deleted', job: removed }
      await logCall(ctx, '/scheduler/jobs/delete', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Job ${String(req.job_id)} not found` }
  await logCall(ctx, '/scheduler/jobs/delete', req, resp)
  return ok(resp)
}

async function jobHistory(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, HISTORY)
  if (isReply(req)) return req
  for (const j of await load(ctx.db, 'jobs')) {
    if (j.job_id === req.job_id) {
      const history = get(j, 'execution_history', []) as Json[]
      const limited = history.slice(0, Number(req.limit))
      const resp = { job_id: req.job_id!, history: limited, total: history.length }
      await logCall(ctx, '/scheduler/jobs/history', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Job ${String(req.job_id)} not found` }
  await logCall(ctx, '/scheduler/jobs/history', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({
    calls: await calls(ctx.db),
    created_jobs: await load(ctx.db, 'created_jobs'),
    updated_jobs: await load(ctx.db, 'updated_jobs'),
    deleted_jobs: await load(ctx.db, 'deleted_jobs'),
  })
}

export function schedulerRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/scheduler/jobs', listJobs, { write: true }),
    route<C>('POST', '/scheduler/jobs/get', getJob, { write: true }),
    route<C>('POST', '/scheduler/jobs/create', createJob, { write: true }),
    route<C>('POST', '/scheduler/jobs/update', updateJob, { write: true }),
    route<C>('POST', '/scheduler/jobs/delete', deleteJob, { write: true }),
    route<C>('POST', '/scheduler/jobs/history', jobHistory, { write: true }),
    route<C>('GET', '/scheduler/audit', audit),
  ]
}
