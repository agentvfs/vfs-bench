/**
 * Claw-Eval (claw-eval/claw-eval @ 5680b8b, MIT): personal-assistant tasks
 * over mock services (gmail, calendar, crm, helpdesk, ...), graded by each
 * task's own grader, which asks an LLM judge for part of the score.
 *
 * A task's services run unchanged (`serve.py`), each loading the task's
 * fixtures as upstream's runner starts it. Upstream gives the model one
 * tool per service endpoint (`helpdesk_get_ticket`); here each service is
 * a CLI with those tools as subcommands (`helpdesk get-ticket`), and each
 * call is logged as upstream's dispatcher logs it. The task's `grader.py`
 * grades unchanged from those calls, the agent's replies and the services'
 * audit logs (`grade.py`), and a task passes at upstream's threshold, a
 * task score of 0.75. Setup: `python3 -I claweval/setup.py`.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

import { type JsonSchema, type Send, type Tool, kebab, toolsCli } from '../clis/tools.ts'
import type { FakeSpec } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import type { Run } from '../harness/runs.ts'
import { type Outcome, type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(STATE, 'claweval', 'src')

interface Service {
  name: string
  command: string
  port: number
  reset_endpoint?: string
  env?: Record<string, string>
}

/** What this port reads of a task's `task.yaml`. */
interface Upstream {
  task_id: string
  prompt: { text: string }
  services: Service[]
  tools: { name: string; description: string; input_schema: JsonSchema }[]
  tool_endpoints: { tool_name: string; url: string; method: string }[]
  environment: { mock_today?: string }
}

/** A tool call as upstream's trace records it (`ToolDispatch`). */
interface Dispatch {
  tool_use_id: string
  tool_name: string
  endpoint_url: string
  request_body: Record<string, unknown>
  response_status: number
  response_body: unknown
}

/** A content block of upstream's `Message`. */
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: { type: 'text'; text: string }[]; is_error: boolean }

interface Message {
  role: 'user' | 'assistant'
  content: Block[]
}

/** A service's fake: `GMAIL`, `HELPDESK`. */
const fakeName = (service: string) => service.toUpperCase().replace(/-/g, '_')

const dispatchLog = (run: Run) => join(run.dir, 'dispatches.jsonl')

function fake(service: Service, today: string | undefined): FakeSpec {
  const [python, script, ...rest] = service.command.split(' ')
  if (python !== 'python' || script === undefined || rest.length > 0) {
    throw new Error(`${service.name}: expected 'python <server.py>', got '${service.command}'`)
  }
  return {
    name: fakeName(service.name),
    argv: ['uv', 'run', '--quiet', '--project', HERE, 'python', '-I', join(HERE, 'serve.py'), script, fakeName(service.name)],
    cwd: SRC,
    env: {
      ...service.env,
      ...(today === undefined ? {} : { MOCK_TODAY: today }),
      // Off, as upstream's runner leaves it (`mock_services/_base.py`).
      ERROR_RATE: '0',
    },
  }
}

/** Each tool's service, by the port its endpoint is on. */
function serviceOf(spec: Upstream, tool: string): { service: Service; endpoint: Upstream['tool_endpoints'][number] } {
  const endpoint = spec.tool_endpoints.find((e) => e.tool_name === tool)
  if (endpoint === undefined) throw new Error(`no endpoint for tool '${tool}'`)
  const port = Number(new URL(endpoint.url).port)
  const service = spec.services.find((s) => s.port === port)
  if (service === undefined) throw new Error(`no service on port ${port} for tool '${tool}'`)
  return { service, endpoint }
}

/**
 * Carries a call as upstream's dispatcher does (`runner/dispatcher.py`):
 * the arguments as the JSON body to the tool's endpoint, the reply's JSON
 * as the result, an error from status 400 up, and any failure as a 500.
 * Each call is logged as its dispatch, under upstream's endpoint URL.
 */
function sender(run: Run, spec: Upstream): Send {
  let calls = 0
  return async (tool, args, { url }) => {
    const { endpoint } = serviceOf(spec, tool.call!)
    let status: number
    let body: unknown
    try {
      const reply = await fetch(`${url}${new URL(endpoint.url).pathname}`, {
        method: endpoint.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
      })
      status = reply.status
      body = await reply.json()
    } catch (error) {
      status = 500
      body = { error: String(error) }
    }
    const dispatch: Dispatch = {
      tool_use_id: `call_${++calls}`,
      tool_name: tool.call!,
      endpoint_url: endpoint.url,
      request_body: args,
      response_status: status,
      response_body: body,
    }
    appendFileSync(dispatchLog(run), `${JSON.stringify(dispatch)}\n`)
    return status < 400 ? { ok: true, result: body } : { ok: false, error: JSON.stringify(body, null, 2) }
  }
}

function dispatches(run: Run): Dispatch[] {
  if (!existsSync(dispatchLog(run))) return []
  return readFileSync(dispatchLog(run), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Dispatch)
}

/** A tool call's output as text. */
function textOf(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map((o: { stdout?: string; stderr?: string }) => `${o.stdout ?? ''}${o.stderr ?? ''}`).join('\n')
  const text = (output as { text?: unknown } | null)?.text
  return typeof text === 'string' ? text : JSON.stringify(output)
}

/**
 * The run as upstream's trace records it: the user's prompt, then each
 * model turn (its text and tool calls) and the tool results that answer
 * it. The items are the agents SDK's, or an oracle's shell calls.
 */
function messages(prompt: string, outcome: Outcome): Message[] {
  const out: Message[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  const add = (role: Message['role'], block: Block) => {
    const last = out.at(-1)!
    if (last.role === role) last.content.push(block)
    else out.push({ role, content: [block] })
  }
  const result = (id: string, text: string, error: boolean) =>
    add('user', { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: error })
  for (const [i, raw] of outcome.items.entries()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = raw as Record<string, any>
    const type = String(item.type ?? '')
    if (typeof item.command === 'string') {
      const id = `oracle_${i}`
      add('assistant', { type: 'tool_use', id, name: 'shell', input: { commands: [item.command] } })
      result(id, `${item.stdout}${item.stderr}`, item.exit_code !== 0)
    } else if (type === 'message' && item.role === 'assistant') {
      const parts = (item.content as { type: string; text?: string }[]).filter((c) => c.type === 'output_text')
      add('assistant', { type: 'text', text: parts.map((c) => c.text).join('\n') })
    } else if (type.endsWith('_call')) {
      const input = item.action ?? item.operation ?? JSON.parse(item.arguments ?? '{}')
      add('assistant', { type: 'tool_use', id: item.callId, name: item.name ?? type.replace(/_call$/, ''), input })
    } else if (type.endsWith('_call_output') || type.endsWith('_call_result')) {
      const failed = Array.isArray(item.output) && item.output.some((o: { outcome?: { exitCode?: number } }) => o.outcome?.exitCode !== 0)
      result(item.callId, textOf(item.output), failed)
    }
  }
  return out
}

interface Result {
  scores: { completion: number; robustness: number; safety: number }
  score: number
  passed: boolean
  judge: { score: number; reasoning: string }[]
  output: string
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const { task } = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { task: string }
  const spec = parse(readFileSync(join(SRC, 'tasks', task, 'task.yaml'), 'utf8')) as Upstream
  const today = spec.environment.mock_today
  return {
    slug,
    dir,
    instruction: spec.prompt.text,
    fakes: () => spec.services.map((service) => fake(service, today)),
    // Each service loads the task's fixtures when it starts.
    seed: async () => null,
    async clis(run) {
      const send = sender(run, spec)
      const tools = new Map<string, Tool[]>()
      for (const tool of spec.tools) {
        const { service } = serviceOf(spec, tool.name)
        const prefix = `${service.name}_`
        const name = tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name
        if (!tools.has(service.name)) tools.set(service.name, [])
        tools.get(service.name)!.push({ name, description: tool.description, parameters: tool.input_schema, call: tool.name })
      }
      return [...tools].map(([service, list]) => ({
        name: kebab(service),
        cli: toolsCli(kebab(service), list, `The ${service} service's tools.`, send),
        config: { url: run.fakes.get(fakeName(service))!.url },
      }))
    },
    // Each service's audit log, which upstream's runner fetches for the
    // grader once the agent stops.
    async snapshot(run) {
      const out: Record<string, unknown> = {}
      for (const service of spec.services) {
        if (service.reset_endpoint === undefined) continue
        const audit = `${new URL(service.reset_endpoint).pathname.replace(/\/reset$/, '')}/audit`
        out[service.name] = await run.fakes.get(fakeName(service.name))!.get(audit)
      }
      return out
    },
    // Upstream's system prompt gives the day the fixtures are set on.
    instructions: (skills) => (today === undefined ? skills : `Current date: ${today}\n\n${skills}`),
    async grade({ run, after, outcome }) {
      const result = (await runPython(HERE, join(HERE, 'grade.py'), {
        src: SRC,
        task,
        messages: messages(spec.prompt.text, outcome),
        dispatches: dispatches(run),
        audit: after,
      })) as Result
      const { completion, robustness, safety } = result.scores
      return graded([
        {
          name: 'task score >= 0.75',
          passed: result.passed,
          detail: [
            `${result.score} = safety ${safety} × (0.8 × completion ${completion} + 0.2 × robustness ${robustness})`,
            ...result.judge.map((call) => `judge ${call.score}: ${call.reasoning}`),
            result.output,
          ].join('\n'),
        },
      ])
    },
  }
}
