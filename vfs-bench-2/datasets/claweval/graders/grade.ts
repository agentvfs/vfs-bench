/**
 * Grade one Claw-Eval trial with the task's own grader, ported (`port/`),
 * as upstream's runner grades it: the messages, dispatches and audit of
 * `trace.ts`, the task's grader, upstream's judge over the chat
 * completions API, and `compute_task_score`.
 *
 * The judge is upstream's (`port/claw_eval/graders/llm_judge.ts`), its
 * client a tape (`judge-client.ts`): each call the tape lacks suspends the
 * grade, `transport` sends it, and the grade runs again from the start
 * with that reply recorded. When the judge gives up retrying, the grade
 * fails, where upstream would score that part 0, failing the agent for the
 * judge's outage.
 */
import { setTimeout as delay } from 'node:timers/promises'
import * as $ from './py.ts'
import { DimensionScores, TaskDefinition, ToolDispatch, TraceMessage } from './models.ts'
import { JudgeRequest, ReplayMismatch, session, type Recording } from './judge-client.ts'
import { LLMJudge } from './port/claw_eval/graders/llm_judge.ts'
import { compute_task_score, is_pass } from './port/claw_eval/models/scoring.ts'
import { GRADERS, MEDIA, TASKS, load } from './port/registry.ts'
import { dispatches, gwsTrace, messages, type Run } from './trace.ts'

export const JUDGE_MODEL = 'google/gemini-3-flash-preview'
/** The most judge calls one grade may make; upstream retries 30 times. */
const MAX_CALLS = 128

class Unanswered extends $.BaseException {}
/** Upstream's judge, over the chat completions API where upstream calls
 * Gemini natively; when it gives up retrying, the grade stops. */
class Judge extends LLMJudge {
  constructor(model: string) {
    super($.kw({ model_id: model, api_key: 'unused', base_url: 'https://judge.invalid/v1' }))
    ;(this as any)._use_gemini = false
  }
  private answered(value: any) {
    if (value === null || value === undefined) throw new Unanswered('the judge did not answer')
    return value
  }
  override evaluate(...args: any[]) {
    return this.answered(super.evaluate(...args))
  }
  override evaluate_actions(...args: any[]) {
    return this.answered(super.evaluate_actions(...args))
  }
}

export interface Inputs {
  task: string
  run: Run
  /** Each service's `/audit` as JSON text, `{}` for none. */
  audit: string
  model: string
}
export type Transport = (request: Record<string, unknown>, signal?: AbortSignal) => Promise<Omit<Recording, 'request'>>
export interface Result {
  score: number
  rewards: { reward: number; completion: number; robustness: number; safety: number; passed: number }
  details: { scores: unknown; judge: unknown; gws_dispatches: unknown; output: string }
  tape: Recording[]
}

/** The task's grader class, from its ported module. */
async function graderOf(task: string): Promise<new () => any> {
  const name = GRADERS[task]
  if (!name || !TASKS[task]) throw new Error(`No Claw-Eval grader for ${task}`)
  return (await load(task))[name]
}

/** One pass of the grade over `tape`: its result, or the judge call it
 * needs next. */
export function gradeOnce(
  inputs: Inputs,
  tape: Recording[],
  Grader: new () => any
): Omit<Result, 'tape'> | JudgeRequest {
  const data = TASKS[inputs.task]!
  $.now.iso = inputs.run.epoch
  $.random.seed(0)
  $.stdout.length = 0
  session.tape = tape
  session.cursor = 0
  session.delay = 0
  const task = new TaskDefinition(data)
  const trace = { trace_id: inputs.task }
  const audit = $.json.loads(inputs.audit)
  const traceMessages = messages(inputs.run, task.prompt.text).map(
    (m) => new TraceMessage({ ...trace, message: m })
  )
  const built = gwsTrace(inputs.run, task, audit)
  const traceDispatches = [...dispatches(inputs.run), ...built].map(
    (d) => new ToolDispatch({ ...trace, ...Object.fromEntries(d.entries()) })
  )
  let scores: DimensionScores
  let judge: Judge
  try {
    judge = new Judge(inputs.model)
    const grader = new Grader()
    const keywords: Record<string, any> = { audit_data: audit, judge }
    if (MEDIA.has(inputs.task)) keywords.media_events = []
    scores = grader.grade(traceMessages, traceDispatches, task, $.kw(keywords))
  } catch (error) {
    if (error instanceof JudgeRequest) return error
    throw error
  }
  if (session.cursor !== tape.length) throw new ReplayMismatch(`Unused recorded judge responses: ${tape.length - session.cursor}`)
  const score = compute_task_score(scores)
  const parts = scores.model_dump()
  const rewards = {
    reward: score,
    completion: $.gi(parts, 'completion'),
    robustness: $.gi(parts, 'robustness'),
    safety: $.gi(parts, 'safety'),
    passed: is_pass(score) ? 1 : 0,
  }
  const output = $.stdout.join('')
  return {
    score,
    rewards,
    details: {
      scores: $.toJSON(parts),
      judge: $.toJSON(judge.get_call_log()),
      gws_dispatches: $.toJSON(built),
      output,
    },
  }
}

/** The grade, sending each judge call the tape lacks through `transport`
 * (after upstream's backoff, unless `wait` is false: a replay). Each reply
 * goes onto `tape`, which keeps them when the grade fails. */
export async function grade(
  inputs: Inputs,
  transport: Transport,
  signal?: AbortSignal,
  wait = true,
  tape: Recording[] = []
): Promise<Result> {
  const Grader = await graderOf(inputs.task)
  for (;;) {
    signal?.throwIfAborted()
    const outcome = gradeOnce(inputs, tape, Grader)
    if (!(outcome instanceof JudgeRequest)) return { ...outcome, tape }
    if (tape.length >= MAX_CALLS) throw new Error('Claw-Eval judge call limit exceeded')
    // Upstream's backoff between retries, which the grade asked to sleep.
    if (wait && outcome.delay > 0) await delay(Math.min(outcome.delay, 60) * 1000, undefined, { signal })
    tape.push({ request: outcome.request, ...(await transport(outcome.request, signal)) })
  }
}

/** A tape's replies, for regrading a recorded run. */
export function replay(recording: Recording[]): Transport {
  let i = 0
  return async (request) => {
    const entry = recording[i++]
    if (!entry) throw new Error(`Judge request ${i} is past the recording's ${recording.length}`)
    const [want, got] = [JSON.stringify(entry.request), JSON.stringify(request)]
    if (want !== got) {
      let at = 0
      while (at < want.length && want[at] === got[at]) at++
      throw new Error(
        `Judge request ${i} differs from recording at ${at}: ` +
          `${JSON.stringify(want.slice(at - 40, at + 80))} != ${JSON.stringify(got.slice(at - 40, at + 80))}`
      )
    }
    const { request: _, ...reply } = entry
    return reply
  }
}
