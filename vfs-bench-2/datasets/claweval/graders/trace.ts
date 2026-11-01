/**
 * A trial as upstream's runner hands it to a grader:
 * - the messages: the task's prompt, then the agent's Harbor trajectory
 *   (ATIF), each agent step its text, its tool calls and their results, as
 *   upstream's trace records a model's turns;
 * - the dispatches: each tool CLI call, as the trial's daemon logged it;
 * - the audit: each service's `/audit`, fetched at its upstream port.
 *
 * A task's gmail and calendar are Mirage's gws fake, reached through the
 * `/gmail` and `/calendar` mounts and the `gws` CLI, not upstream's tools,
 * so neither their dispatches nor their audit logs exist. They are built
 * here as upstream's services would have logged them, from the task's
 * fixtures under upstream's ids (`gws_seed.json`), the trajectory and the
 * gws run's tables (README, "Gmail and calendar"):
 * - `gmail_get_message`: once for each fixture email whose body (its first
 *   50 characters, whitespace and JSON escapes aside) a tool result showed;
 * - `gmail_list_messages`: once for each tool result that showed a fixture
 *   email's id, with upstream's default arguments;
 * - `calendar_list_events`: once for each day a tool result showed a
 *   fixture event of (its id), as `{"date": <day>, "days": 1}`, and
 *   `calendar_get_user_events` once for each attendee of those events and
 *   that day;
 * - `gmail_send_message`: each message in the run's SENT that the fixture
 *   lacks, as `{to, subject, body}`;
 * - `calendar_create_event`: each event in the run the fixture lacks, as
 *   `{title, start_time, end_time, attendees, location}`;
 * - `calendar_delete_event`: each fixture event gone from the run or
 *   cancelled.
 * Each answers as upstream's service would, status 200, and is logged in
 * the service's audit with upstream's endpoint. Values are Python's
 * (`py.ts`), as the graders read them.
 */
import * as $ from './py.ts'
import type { TaskDefinition } from './models.ts'

type Dict = $.PyDict
const GWS = ['gmail', 'calendar']
// Upstream's endpoints for a gmail or calendar tool the task does not list.
const ENDPOINTS: Record<string, string> = {
  gmail_list_messages: 'http://localhost:9100/gmail/messages',
  gmail_get_message: 'http://localhost:9100/gmail/messages/get',
  gmail_send_message: 'http://localhost:9100/gmail/send',
  calendar_list_events: 'http://localhost:9101/calendar/events',
  calendar_get_user_events: 'http://localhost:9101/calendar/user_events',
  calendar_create_event: 'http://localhost:9101/calendar/events/create',
  calendar_delete_event: 'http://localhost:9101/calendar/events/delete',
}
// How much of an email's body a tool result shows for it to count as read.
const BODY_KEY = 50

/** `d.get(k, fallback)`. */
function get(d: any, k: any, fallback: any = null): any {
  if (!(d instanceof $.PyDict)) throw new $.AttributeError(`'${$.typeName(d)}' object has no attribute 'get'`)
  const e = d.lookup(k)
  return e ? e[1] : fallback
}
const dict = (entries: [string, any][]) => new $.PyDict(entries)

/** The run's inputs, as the verifier stages them. */
export interface Run {
  trajectory: string | null
  dispatches: string | null
  seed: string | null
  /** The gws fake's tables at the end of the run, `{}` without gws. */
  gws: Dict
  epoch: string
}

function steps(run: Run): Dict[] {
  if (run.trajectory === null) return []
  return $.list(get($.json.loads(run.trajectory), 'steps', [])).filter((s: any) => get(s, 'source') === 'agent')
}
/** An ATIF message or result as text: a string, or its text parts. */
function textOf(content: any): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return [...$.iter(content)]
    .filter((part) => get(part, 'type') === 'text')
    .map((part) => get(part, 'text', ''))
    .join('\n')
}
function observations(step: Dict): any[] {
  return $.list(get($.or(get(step, 'observation'), () => new $.PyDict()), 'results', []))
}
/** The run as upstream's trace records it: the prompt, then each agent
 * step's text and tool calls, and the results that answer them. */
export function messages(run: Run, prompt: string): Dict[] {
  const out: Dict[] = [dict([['role', 'user'], ['content', [dict([['type', 'text'], ['text', prompt]])]]])]
  const add = (role: string, block: Dict) => {
    const last = out[out.length - 1]!
    if (get(last, 'role') === role) $.gi(last, 'content').push(block)
    else out.push(dict([['role', role], ['content', [block]]]))
  }
  for (const step of steps(run)) {
    const text = textOf(get(step, 'message'))
    if (text) add('assistant', dict([['type', 'text'], ['text', text]]))
    for (const call of $.iter($.or(get(step, 'tool_calls'), () => []))) {
      add(
        'assistant',
        dict([
          ['type', 'tool_use'],
          ['id', $.gi(call, 'tool_call_id')],
          ['name', $.gi(call, 'function_name')],
          ['input', $.or(get(call, 'arguments'), () => new $.PyDict())],
        ])
      )
    }
    for (const result of observations(step)) {
      add(
        'user',
        dict([
          ['type', 'tool_result'],
          ['tool_use_id', $.or(get(result, 'source_call_id'), () => '')],
          ['content', [dict([['type', 'text'], ['text', textOf(get(result, 'content'))]])]],
          ['is_error', false],
        ])
      )
    }
  }
  return out
}
/** What each of the agent's tool calls returned, in order. */
function results(run: Run): string[] {
  return steps(run).flatMap((step) => observations(step).map((r) => textOf(get(r, 'content'))))
}
/** The tool CLIs' calls, as the trial's daemon logged them. */
export function dispatches(run: Run): Dict[] {
  if (run.dispatches === null) return []
  return ($.call(run.dispatches, 'splitlines') as string[]).filter(Boolean).map((line) => $.json.loads(line))
}
/** Text with JSON's escapes read and all whitespace gone, so a body
 * matches however a listing printed it. */
function flat(text: string): string {
  text = $.re.sub('\\\\u([0-9a-fA-F]{4})', (m: $.Match) => String.fromCharCode(parseInt(m.group(1), 16)), text)
  for (const [escape, char] of [
    ['\\n', '\n'],
    ['\\t', '\t'],
    ['\\"', '"'],
    ['\\/', '/'],
    ['\\r', '\r'],
  ] as const)
    text = text.split(escape).join(char)
  return $.re.sub('\\s+', '', text)
}

/** Dispatches and audit calls built for gmail and calendar. */
class Trace {
  dispatches: Dict[] = []
  calls: Record<string, Dict[]> = { gmail: [], calendar: [] }
  readonly endpoints: Map<string, string>
  readonly epoch: string
  constructor(endpoints: Map<string, string>, epoch: string) {
    this.endpoints = endpoints
    this.epoch = epoch
  }
  add(tool: string, request: Dict, response: any) {
    const url = this.endpoints.get(tool) ?? ENDPOINTS[tool]!
    this.dispatches.push(
      dict([
        ['tool_use_id', `gws_${this.dispatches.length + 1}`],
        ['tool_name', tool],
        ['endpoint_url', url],
        ['request_body', request],
        ['response_status', 200],
        ['response_body', response],
        ['timestamp', this.epoch],
      ])
    )
    this.calls[tool.split('_')[0]!]!.push(
      dict([
        ['endpoint', $.re.sub('^https?://[^/]+', '', url)],
        ['request_body', request],
        ['response_body', response],
        ['timestamp', this.epoch],
      ])
    )
  }
}
/** An email as upstream's `list_messages` lists it. */
function summary(email: Dict): Dict {
  return dict(['message_id', 'from', 'subject', 'date', 'is_read', 'labels'].map((k) => [k, $.gi(email, k)]))
}
/** The gmail and calendar reads the tool results show. */
function reads(trace: Trace, seed: Dict, shown: string[]) {
  const emails: Dict[] = $.gi(seed, 'gmail'),
    events: Dict[] = $.gi(seed, 'calendar')
  const got = new Set<string>()
  const days = new Set<string>()
  const users = new $.PySet()
  const start = (e: Dict) => $.gi(e, 'start_time')
  const attendees = (e: Dict): any[] => $.list(get(e, 'attendees', []))
  for (const text of shown) {
    const body = flat(text)
    const listed = emails.filter((e) => $.in_($.gi(e, 'message_id'), text))
    if (listed.length)
      trace.add(
        'gmail_list_messages',
        dict([
          ['days_back', 7],
          ['max_results', 20],
        ]),
        dict([
          ['messages', listed.map(summary)],
          ['total', listed.length],
        ])
      )
    for (const email of emails) {
      const key = $.sl(flat($.gi(email, 'body')), undefined, BODY_KEY)
      const id = $.gi(email, 'message_id')
      if (!got.has(id) && key && body.includes(key)) {
        got.add(id)
        trace.add('gmail_get_message', dict([['message_id', id]]), email)
      }
    }
    const seen = events.filter((e) => $.in_($.gi(e, 'event_id'), text))
    for (const day of $.sorted($.set(seen.map((e) => $.sl(start(e), undefined, 10))))) {
      const onDay = $.sorted(
        events.filter((e) => $.eq($.sl(start(e), undefined, 10), day)),
        $.kw({ key: start })
      )
      if (!days.has(day)) {
        days.add(day)
        trace.add(
          'calendar_list_events',
          dict([
            ['date', day],
            ['days', 1],
          ]),
          dict([
            ['events', onDay],
            ['total', onDay.length],
          ])
        )
      }
      const people = $.dict.fromkeys(
        seen.filter((e) => $.eq($.sl(start(e), undefined, 10), day)).flatMap((e) => attendees(e))
      )
      for (const user of people.keys()) {
        if (users.has($.tuple(user, day))) continue
        users.add($.tuple(user, day))
        const theirs = onDay.filter((e) => $.in_(user, attendees(e)))
        trace.add(
          'calendar_get_user_events',
          dict([
            ['user', user],
            ['date', day],
          ]),
          dict([
            ['events', theirs],
            ['total', theirs.length],
            ['user', user],
          ])
        )
      }
    }
  }
}
/** A table's rows sorted as SQLite orders them: NULL first, then by value,
 * ties in the table's order. */
function ordered(tables: Dict, name: string, ...keys: string[]): Dict[] {
  return $.sorted(
    get(tables, name, []),
    $.kw({ key: (row: Dict) => $.tuple(...keys.map((k) => $.tuple(get(row, k) !== null, get(row, k)))) })
  )
}
function isoformatUtc(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const micro = ms % 1000 ? '.' + p((((ms % 1000) + 1000) % 1000) * 1000, 6) : ''
  return (
    `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${micro}+00:00`
  )
}
/** The sends, the events created and the events deleted, from the gws
 * run's tables: what the run holds that the fixture does not, and the
 * fixture events it no longer holds. */
function writes(trace: Trace, seed: Dict, tables: Dict): [Dict[], Dict[], Dict[]] {
  const sent: Dict[] = [],
    created: Dict[] = [],
    deleted: Dict[] = []
  if (!$.t(tables)) return [sent, created, deleted]
  const seeded = new $.PySet(($.gi(seed, 'gmail') as Dict[]).map((e) => $.gi(e, 'message_id')))
  const labels = new $.PyDict()
  for (const row of $.iter($.gi(tables, 'MessageLabel'))) {
    if (!labels.has($.gi(row, 'messageId'))) labels.set($.gi(row, 'messageId'), new $.PySet())
    $.gi(labels, $.gi(row, 'messageId')).add($.gi(row, 'labelId'))
  }
  const headers = new $.PyDict()
  for (const row of ordered(tables, 'MessageHeader', 'seq', 'pk')) {
    const id = $.gi(row, 'messageId')
    if (!headers.has(id)) headers.set(id, new $.PyDict())
    const own: Dict = $.gi(headers, id)
    const name = $.call($.gi(row, 'name'), 'lower')
    if (!own.has(name)) own.set(name, $.gi(row, 'value'))
  }
  for (const row of ordered(tables, 'Message', 'internalDate', 'seq')) {
    const id = $.gi(row, 'id')
    const mine: $.PySet = get(labels, id, new $.PySet())
    if (seeded.has(id) || !mine.has('SENT') || mine.has('DRAFT')) continue
    const head = get(headers, id, new $.PyDict())
    const request = dict([
      ['to', get(head, 'to', '')],
      ['subject', get(head, 'subject', '')],
      ['body', $.gi(row, 'bodyText')],
    ])
    const message = dict([...request.entries(), ['timestamp', isoformatUtc($.int($.gi(row, 'internalDate')))]])
    sent.push(message)
    trace.add(
      'gmail_send_message',
      request,
      dict([
        ['status', 'sent'],
        ['message', message],
      ])
    )
  }
  const live = new $.PyDict(ordered(tables, 'Event', 'created', 'seq').map((row) => [$.gi(row, 'id'), row]))
  const fixture = new $.PyDict(($.gi(seed, 'calendar') as Dict[]).map((e) => [$.gi(e, 'event_id'), e]))
  for (const [eventId, row] of live.entries()) {
    if (fixture.has(eventId) || $.gi(row, 'status') === 'cancelled') continue
    const people = $.t($.gi(row, 'attendees')) ? $.json.loads($.gi(row, 'attendees')) : []
    const request = dict([
      ['title', $.or($.gi(row, 'summary'), () => '')],
      ['start_time', $.or($.gi(row, 'startDateTime'), () => $.or($.gi(row, 'startDate'), () => ''))],
      ['end_time', $.or($.gi(row, 'endDateTime'), () => $.or($.gi(row, 'endDate'), () => ''))],
      [
        'attendees',
        [...$.iter(people)]
          .filter((p) => p instanceof $.PyDict)
          .map((p) => $.or(get(p, 'email'), () => $.or(get(p, 'displayName'), () => ''))),
      ],
      ['location', $.or($.gi(row, 'location'), () => '')],
    ])
    const event = dict([['event_id', eventId], ...request.entries(), ['recurring', false]])
    created.push(event)
    trace.add(
      'calendar_create_event',
      request,
      dict([
        ['status', 'created'],
        ['event', event],
      ])
    )
  }
  for (const [eventId, event] of fixture.entries()) {
    const row = get(live, eventId)
    if (row === null || $.gi(row, 'status') === 'cancelled') {
      deleted.push(event)
      trace.add(
        'calendar_delete_event',
        dict([['event_id', eventId]]),
        dict([
          ['status', 'deleted'],
          ['event', event],
        ])
      )
    }
  }
  return [sent, created, deleted]
}
/** Gmail's and calendar's dispatches, built as upstream's services would
 * have logged them, with their audit logs added to `audit`. */
export function gwsTrace(run: Run, task: TaskDefinition, audit: Dict): Dict[] {
  const used = task.services.map((s) => s.name).filter((n) => GWS.includes(n))
  if (!used.length) return []
  if (run.seed === null) throw new $.FileNotFoundError('gws_seed.json')
  const seed = $.json.loads(run.seed)
  const trace = new Trace(new Map(task.tool_endpoints.map((e) => [e.tool_name, e.url])), run.epoch)
  reads(trace, seed, results(run))
  const [sent, created, deleted] = writes(trace, seed, run.gws)
  if (used.includes('gmail')) {
    const drafts = get(audit, 'gmail', new $.PyDict())
    audit.set(
      'gmail',
      dict([
        ['calls', $.add(get(drafts, 'calls', []), trace.calls.gmail)],
        ['sent', sent],
        ['drafts', get(drafts, 'drafts', [])],
      ])
    )
  }
  if (used.includes('calendar'))
    audit.set(
      'calendar',
      dict([
        ['calls', trace.calls.calendar],
        ['deleted', deleted],
        ['created_events', created],
      ])
    )
  return trace.dispatches
}
