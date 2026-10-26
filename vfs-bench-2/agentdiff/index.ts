/**
 * Agent-Diff (agent-diff-bench/agent-diff @ 3bb9c40, MIT): tasks against
 * replicas of Box, Slack, Linear and Google Calendar, graded on the
 * database diff they leave.
 *
 * Upstream's backend runs unchanged under Docker, one compose project per
 * run (`backend.ts`, `compose.yaml`). A run gets its own environment from
 * the task's seed template, impersonating the task's user, as upstream's
 * SDK starts one. Upstream's agent calls the service's HTTP API with curl;
 * here the API is a CLI generated from the service's own API description,
 * the operations the replica implements (`box`, from box/box-openapi), and
 * Box's files are also mounted at `/box`. The system prompt keeps
 * upstream's session and environment lines (its ReAct prompt) without its
 * XML reply format. Upstream's evaluator grades the run's diff against the
 * task's assertions. Setup: `python3 -I agentdiff/setup.py`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type OpenApi, openapiCli } from '../clis/openapi.ts'
import { STATE } from '../harness/paths.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(STATE, 'agentdiff')
const SRC = join(DATA, 'src')
const FAKE = 'AGENTDIFF'

interface Row {
  question: string
  answer: string
  test_id: string
  test_name: string
  service: string
  info: string
}

interface Info {
  service: string
  seed_template: string
  impersonate_user_id?: string
  impersonate_email?: string
}

/** Upstream's per-service session lines (its notebook's `SERVICE_CONFIG`). */
const SERVICES: Record<string, { name: string; description: string }> = {
  box: { name: 'Box', description: 'Box cloud storage and file management API' },
}

/** Upstream's ReAct prompt up to its reply format, for this harness's CLI. */
function prompt(service: { name: string; description: string }, cli: string): string {
  return `You are an AI assistant that completes tasks by interacting with APIs via bash commands.

## Current Session
- **Service**: ${service.name}
- **Description**: ${service.description}
- **CLI**: \`${cli}\`, one command per API operation; \`${cli} --help\` lists them.

## Environment
- You are authenticated as a user in the ${service.name} workspace/account.
- Authentication is handled automatically.
- If you are not sure how to use the ${service.name} API, explore the commands, their parameters, and learn how they work.

## Rules
1. Parse API responses carefully - extract IDs and data needed for subsequent calls.
2. If a command fails, analyze the error and try a different approach.
3. Only finish when the task is fully completed (not just when you've gathered information).`
}

/** `/files/{file_id}` and `/files/{id}` alike. */
const shape = (method: string, path: string) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`

/**
 * Box's API description for the operations the replica serves: the main
 * spec, and the 2025.0 one for Box Hubs, which the main one lacks.
 */
function boxSpec(): OpenApi {
  const routes = readFileSync(join(SRC, 'backend', 'src', 'services', 'box', 'api', 'routes.py'), 'utf8')
  const served = new Set([...routes.matchAll(/Route\(\s*"([^"]+)",\s*\w+,\s*methods=\["(\w+)"\]/g)].map((m) => shape(m[2]!, m[1]!)))
  const main = JSON.parse(readFileSync(join(DATA, 'box-openapi.json'), 'utf8')) as OpenApi
  const hubs = JSON.parse(readFileSync(join(DATA, 'box-openapi-v2025.0.json'), 'utf8')) as OpenApi
  const spec: OpenApi = {
    paths: { ...hubs.paths, ...main.paths },
    components: {
      schemas: { ...hubs.components?.schemas, ...main.components?.schemas },
      parameters: { ...hubs.components?.parameters, ...main.components?.parameters },
    },
  }
  for (const [path, item] of Object.entries(spec.paths)) {
    const kept = Object.fromEntries(Object.entries(item).filter(([method]) => served.has(shape(method, path))))
    if (Object.keys(kept).length > 0) spec.paths[path] = kept
    else delete spec.paths[path]
  }
  return spec
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const { test_id: testId } = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { test_id: string }
  const rows = readFileSync(join(SRC, 'datasets', 'agent-diff-bench', 'all_numbered.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row)
  const row = rows.find((r) => r.test_id === testId)
  if (row === undefined) throw new Error(`no Agent-Diff task ${testId}`)
  const info = JSON.parse(row.info) as Info
  const service = SERVICES[info.service]
  if (service === undefined) throw new Error(`${testId}: service '${info.service}' is not ported yet`)
  // One run per load: its environment and run, from seed() on.
  let session: { base: string; envId: string; runId: string } | null = null
  const platform = async (url: string, path: string, body: unknown) => {
    const reply = await fetch(`${url}/api/platform/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!reply.ok) throw new Error(`Agent-Diff ${path}: ${reply.status} ${await reply.text()}`)
    return reply.json() as Promise<Record<string, unknown>>
  }
  return {
    slug,
    dir,
    instruction: row.question,
    instructions: (skills) => `${prompt(service, info.service)}\n\n${skills}`,
    fakes: (run) => [
      {
        name: FAKE,
        argv: [process.execPath, join(HERE, 'backend.ts'), '--project', `vfsbench-agentdiff-${run.id}`.toLowerCase(), '--seed', info.service],
        readyTimeout: 300,
      },
    ],
    async seed(run) {
      const url = run.fakes.get(FAKE)!.url
      const env = await platform(url, 'initEnv', {
        templateService: info.service,
        templateName: info.seed_template,
        impersonateUserId: info.impersonate_user_id,
        impersonateEmail: info.impersonate_email,
      })
      const started = await platform(url, 'startRun', { envId: env.environmentId })
      session = { base: `${url}${String(env.environmentUrl)}`, envId: String(env.environmentId), runId: String(started.runId) }
      run.env.BOX_ENDPOINT = session.base
      return session
    },
    async clis() {
      return [{ name: 'box', cli: openapiCli('box', boxSpec(), `The ${service.description}.`), config: { url: `${session!.base}/2.0` } }]
    },
    async snapshot(run) {
      if (session === null) return null
      return platform(run.fakes.get(FAKE)!.url, 'diffRun', { runId: session.runId })
    },
    async grade({ run }) {
      const url = run.fakes.get(FAKE)!.url
      const result = await platform(url, 'evaluateRun', { runId: session!.runId, expectedOutput: JSON.parse(row.answer) })
      const detail = (await (await fetch(`${url}/api/platform/results/${session!.runId}`)).json()) as {
        failures?: string[]
        score?: unknown
      }
      return graded([
        ...(detail.failures ?? []).map((f, i) => ({ name: `assertion failure #${i + 1}`, passed: false, detail: f })),
        { name: 'evaluateRun passed', passed: result.passed === true, detail: JSON.stringify(detail.score ?? result.score) },
      ])
    },
  }
}
