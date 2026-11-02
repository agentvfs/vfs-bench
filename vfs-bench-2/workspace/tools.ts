/**
 * A task's tools as CLIs in the trial's daemon, loaded by preload.ts when
 * the task names some (`tools` in its workspace.yaml).
 *
 *     VFSBENCH_TOOLS=<tools.json>[:<tools.json>...] VFSBENCH_DISPATCHES=<file>
 *
 * `tools.json` lists each CLI's tools as upstream's task gives them, each
 * with the endpoint upstream's dispatcher posts it to:
 *
 *     [{"name": "helpdesk", "description": "...", "tools": [
 *        {"name": "list_tickets", "call": "helpdesk_list_tickets",
 *         "description": "...", "parameters": {...},
 *         "endpoint": {"url": "http://localhost:9107/helpdesk/tickets",
 *                      "method": "POST"}}]}]
 *
 * Each becomes a named CLI under its spec name (cli.ts's `specName`), so
 * the workspace config's `clis:` installs it, under its own name, with its
 * service's run URL (`config: {url: ...}`), and any headers each call
 * carries (`headers: {...}`).
 * A call goes as upstream's dispatcher sends it (`runner/dispatcher.py`):
 * the arguments as the JSON body to the endpoint's path at that URL, the
 * reply's JSON the result, an error from status 400 up and a failure as a
 * 500. Each is appended to the CLI's `dispatches` log (else
 * `VFSBENCH_DISPATCHES`) as upstream's dispatcher records it, under the
 * endpoint's upstream URL, which the verifier reads.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { type Send, specName, type Tool, toolsCli } from './cli.ts'
import { MIRAGE } from './paths.ts'

interface Endpoint {
  url: string
  method: string
}

interface ToolsCli {
  name: string
  description?: string
  tools: (Tool & { endpoint: Endpoint })[]
}

/** One dispatch, as upstream's `ToolDispatch` has it. */
interface Dispatch {
  tool_use_id: string
  tool_name: string
  endpoint_url: string
  request_body: unknown
  response_status: number
  response_body: unknown
  latency_ms: number
  timestamp: string
}

const files = process.env.VFSBENCH_TOOLS
const log = process.env.VFSBENCH_DISPATCHES
if (files !== undefined) {
  // Every file's CLIs (a daemon of the job's has every task's of the
  // dataset), each once, under its spec name (cli.ts).
  const clis = new Map<string, ToolsCli>()
  for (const file of files.split(delimiter)) {
    for (const cli of JSON.parse(readFileSync(file, 'utf8')) as ToolsCli[]) clis.set(specName(cli), cli)
  }
  // Each log's calls, numbered from 1: a daemon of the job's keeps a log per workspace.
  const calls = new Map<string, number>()
  const send: Send = async (tool, args, { url, headers, dispatches }) => {
    const path = dispatches ?? log
    if (path === undefined) throw new Error(`${tool.name}: no dispatch log (its CLI's \`dispatches\`, or VFSBENCH_DISPATCHES)`)
    const call = (calls.get(path) ?? 0) + 1
    calls.set(path, call)
    const { endpoint } = tool as Tool & { endpoint: Endpoint }
    const started = performance.now()
    let status: number
    let body: unknown
    try {
      const reply = await fetch(`${url}${new URL(endpoint.url).pathname}`, {
        method: endpoint.method,
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(args),
      })
      status = reply.status
      body = await reply.json()
    } catch (error) {
      status = 500
      body = { error: String(error) }
    }
    const dispatch: Dispatch = {
      tool_use_id: `call_${call}`,
      tool_name: tool.call ?? tool.name,
      endpoint_url: endpoint.url,
      request_body: args,
      response_status: status,
      response_body: body,
      latency_ms: performance.now() - started,
      timestamp: new Date().toISOString(),
    }
    appendFileSync(path, `${JSON.stringify(dispatch)}\n`)
    // An error's text, where the body is one (a Gaia2 app's stderr), prints as it is.
    return status < 400
      ? { ok: true, result: body }
      : { ok: false, error: typeof body === 'string' ? body : JSON.stringify(body, null, 2) }
  }
  // The registry the daemon's own Mirage resolves `clis:` against.
  const { registerCliSpec } = (await import(
    pathToFileURL(join(MIRAGE, 'typescript', 'packages', 'core', 'dist', 'commands', 'cli', 'specs.js')).href
  )) as typeof import('@struktoai/mirage-core/commands/cli/specs')
  for (const [name, cli] of clis) registerCliSpec(toolsCli(name, cli.tools, cli.description, send))
}
