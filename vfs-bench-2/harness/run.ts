/**
 * Run one task with a model.
 *
 *     node harness/run.ts <dataset>/<task> --model gpt-5.6-luna
 *
 * The agent is Mirage's own OpenAI Agents integration, as its examples set
 * it up: `read_file`, `shell` over `MirageShellExecutor` and `apply_patch`
 * over `MirageEditor`, with `buildSystemPrompt`. The model is reached the
 * SDK's default way, `OPENAI_API_KEY` and `OPENAI_BASE_URL`, over the
 * Responses API.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  Agent,
  RunResult,
  type RunState,
  applyPatchTool,
  retryPolicies,
  run,
  setOpenAIAPI,
  setTracingDisabled,
  shellTool,
} from '@openai/agents'
import type { Workspace } from '@struktoai/mirage-node'
import { MirageEditor, MirageShellExecutor, mirageReadFileTool } from '@struktoai/mirage-openai-agents'

import { type Outcome, execute } from './execute.ts'
import { ROOT } from './paths.ts'

export interface AgentOptions {
  model: string
  /** Reasoning effort, for a model that takes one. */
  effort?: string | undefined
  /** Model requests allowed. */
  maxTurns: number
}

/** Run the agent until it stops, errs, or hits `maxTurns`. */
export async function runAgent(workspace: Workspace, instructions: string, task: string, opts: AgentOptions): Promise<Outcome> {
  const agent = new Agent({
    name: 'vfs-bench',
    model: opts.model,
    instructions,
    modelSettings: {
      ...(opts.effort === undefined ? {} : { reasoning: { effort: opts.effort as 'low' } }),
      retry: { maxRetries: 4, backoff: { initialDelayMs: 2000, maxDelayMs: 30_000, jitter: true }, policy: RETRY },
    },
    tools: [
      mirageReadFileTool(workspace),
      shellTool({ shell: new MirageShellExecutor(workspace) }),
      applyPatchTool({ editor: new MirageEditor(workspace) }),
    ],
  })
  // Streamed, so a failed model request still leaves the run so far in
  // `result.state`; a thrown provider error carries none.
  const result = await run(agent, task, { maxTurns: opts.maxTurns, stream: true })
  try {
    await result.completed
    return outcome(result.state, 'finished', null, String(result.finalOutput ?? ''))
  } catch (error) {
    return outcome(result.state, (error as Error).constructor.name, String((error as Error).message))
  }
}

/**
 * Retry what the provider or transport says is transient, and a gateway's
 * 400 for a reasoning item it routed to a backend that cannot decrypt it.
 */
const RETRY = retryPolicies.any(
  retryPolicies.providerSuggested(),
  retryPolicies.networkError(),
  retryPolicies.httpStatus([408, 429, 500, 502, 503, 504]),
  ({ error }) => /encrypted content .* could not be verified/i.test(String((error as Error)?.message)),
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = RunState<any, any>

/** The run record's agent fields, from the SDK's run state. */
function outcome(state: AnyState, status: string, error: string | null, finalOutput: string | null = null): Outcome {
  const usage = state.usage
  const sum = (details: unknown[], key: string) =>
    details.reduce((total: number, d) => total + Number((d as Record<string, unknown>)[key] ?? 0), 0)
  return {
    status,
    error,
    final_output: finalOutput,
    usage: {
      requests: usage.requests,
      input_tokens: usage.inputTokens,
      cached_tokens: sum(usage.inputTokensDetails, 'cached_tokens'),
      output_tokens: usage.outputTokens,
      reasoning_tokens: sum(usage.outputTokensDetails, 'reasoning_tokens'),
      total_tokens: usage.totalTokens,
    },
    items: new RunResult(state).output,
  }
}

async function main(): Promise<number> {
  const env = join(ROOT, '.env')
  if (existsSync(env)) process.loadEnvFile(env)
  setTracingDisabled(true)
  setOpenAIAPI('responses')
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      effort: { type: 'string' },
      'max-turns': { type: 'string', default: '50' },
    },
  })
  const ref = positionals[0]
  if (ref === undefined || values.model === undefined) {
    console.error('usage: node harness/run.ts <dataset>/<task> --model <id> [--effort <level>] [--max-turns <n>]')
    return 2
  }
  const opts = { model: values.model, effort: values.effort, maxTurns: Number(values['max-turns']) }
  const record = await execute(ref, (ws, instructions, instruction) => runAgent(ws, instructions, instruction, opts), {
    model: opts.model,
    effort: opts.effort ?? null,
    max_turns: opts.maxTurns,
  })
  const passed = record.checks.filter((c) => c.passed).length
  console.log(
    `${record.status}: ${passed}/${record.checks.length} checks, ${record.passed ? 'PASS' : 'FAIL'}; ` +
      `usage ${JSON.stringify(record.usage)}\ndump: ${record.dump}`,
  )
  return record.passed ? 0 : 1
}

if (import.meta.main) process.exit(await main())
