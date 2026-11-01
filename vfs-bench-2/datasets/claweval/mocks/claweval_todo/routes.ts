/**
 * The todo fake's routes: upstream's `server.py`, each statement kept, over
 * the run's lists. `tasks` is the fixture's tasks; `deleted`,
 * `updated_tasks` and `created_tasks` are what upstream keeps of each
 * delete, update and create.
 *
 * Upstream's create logs its reply holding the very task it appends, not a
 * copy, so the logged reply shows each later update of that task. Here
 * `task_calls` runs beside `tasks`, one doc per task: the audit row of the
 * create whose reply holds it, or null. An update rewrites that row's
 * reply. It starts empty, as every task of the fixture has none.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow, save } from '../claweval/store.ts'
import type { Dict, Json } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { status: opt('all'), priority: opt(null) }
const UPDATE = { task_id: REQUIRED, title: opt(null), priority: opt(null), status: opt(null), tags: opt(null), description: opt(null) }
const CREATE = { title: REQUIRED, description: opt(null), priority: opt('medium'), due_date: opt(null), tags: opt([]) }
const DELETE = { task_id: REQUIRED }
const GET = { task_id: REQUIRED }

const copy = (t: Dict): Dict => structuredClone(t)

/** Python's `d.get(key)`. */
const get = (d: Dict, key: string): Json => (key in d ? d[key]! : null)

/** `task_calls` as it stands, one doc per task: none yet means no task was created or deleted. */
async function taskCalls(ctx: Ctx<C>, tasks: Dict[]): Promise<Dict[]> {
  const docs = await load(ctx.db, 'task_calls')
  return docs.length === tasks.length ? docs : tasks.map(() => ({ call: null }))
}

async function listTasks(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const t of await load(ctx.db, 'tasks')) {
    if (req.status === 'all' || t.status === req.status) {
      if (req.priority && get(t, 'priority') !== req.priority) continue
      results.push(copy(t))
    }
  }
  const resp = { tasks: results, total: results.length }
  await logCall(ctx, '/todo/tasks', req, resp)
  return ok(resp)
}

async function getTask(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const t of await load(ctx.db, 'tasks')) {
    if (t.task_id === req.task_id) {
      const resp = copy(t)
      await logCall(ctx, '/todo/tasks/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Task ${String(req.task_id)} not found` }
  await logCall(ctx, '/todo/tasks/get', req, resp)
  return ok(resp)
}

async function updateTask(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, UPDATE)
  if (isReply(req)) return req
  const tasks = await load(ctx.db, 'tasks')
  for (const [i, t] of tasks.entries()) {
    if (t.task_id === req.task_id) {
      if (req.title !== null) t.title = req.title!
      if (req.priority !== null) t.priority = req.priority!
      if (req.status !== null) t.status = req.status!
      if (req.tags !== null) t.tags = req.tags!
      if (req.description !== null) t.description = req.description!
      await save(ctx.db, 'tasks', tasks)
      const call = (await taskCalls(ctx, tasks))[i]!.call
      if (typeof call === 'number') {
        await ctx.db.auditCall.update({ where: { seq: call }, data: { response_body: JSON.stringify({ status: 'created', task: t }) } })
      }
      const updated = copy(t)
      await append(ctx.db, 'updated_tasks', updated)
      const resp = { status: 'updated', task: updated }
      await logCall(ctx, '/todo/tasks/update', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Task ${String(req.task_id)} not found` }
  await logCall(ctx, '/todo/tasks/update', req, resp)
  return ok(resp)
}

async function createTask(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, CREATE)
  if (isReply(req)) return req
  const tasks = await load(ctx.db, 'tasks')
  const origins = await taskCalls(ctx, tasks)
  const newId = `todo_${String(tasks.length + 1).padStart(3, '0')}`
  const task: Dict = {
    task_id: newId,
    title: req.title!,
    description: req.description || '',
    status: 'pending',
    priority: req.priority!,
    due_date: req.due_date!,
    tags: req.tags!,
    created_at: pyNow(ctx),
  }
  await append(ctx.db, 'tasks', task)
  await append(ctx.db, 'created_tasks', copy(task))
  const resp = { status: 'created', task }
  await logCall(ctx, '/todo/tasks/create', req, resp)
  const logged = await ctx.db.auditCall.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } })
  await save(ctx.db, 'task_calls', [...origins, { call: logged!.seq }])
  return ok(resp)
}

async function deleteTask(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, DELETE)
  if (isReply(req)) return req
  const tasks = await load(ctx.db, 'tasks')
  for (const [i, t] of tasks.entries()) {
    if (t.task_id === req.task_id) {
      const origins = await taskCalls(ctx, tasks)
      const removed = tasks.splice(i, 1)[0]!
      origins.splice(i, 1)
      await save(ctx.db, 'tasks', tasks)
      await save(ctx.db, 'task_calls', origins)
      await append(ctx.db, 'deleted', removed)
      const resp = { status: 'deleted', task: removed }
      await logCall(ctx, '/todo/tasks/delete', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Task ${String(req.task_id)} not found` }
  await logCall(ctx, '/todo/tasks/delete', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({
    calls: await calls(ctx.db),
    deleted: await load(ctx.db, 'deleted'),
    updated_tasks: await load(ctx.db, 'updated_tasks'),
    created_tasks: await load(ctx.db, 'created_tasks'),
  })
}

export function todoRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/todo/tasks', listTasks, { write: true }),
    route<C>('POST', '/todo/tasks/get', getTask, { write: true }),
    route<C>('POST', '/todo/tasks/update', updateTask, { write: true }),
    route<C>('POST', '/todo/tasks/create', createTask, { write: true }),
    route<C>('POST', '/todo/tasks/delete', deleteTask, { write: true }),
    route<C>('GET', '/todo/audit', audit),
  ]
}
