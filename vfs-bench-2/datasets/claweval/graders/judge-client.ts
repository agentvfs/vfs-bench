/**
 * The judge's chat completions client, which the port's `openai.OpenAI`
 * is. A grade runs synchronously, as upstream's does, over a tape of the
 * judge's calls: a call the tape answers returns its recorded reply; the
 * first it does not suspends the grade with the request (`JudgeRequest`),
 * which `judge.ts` sends and records before grading again from the start.
 */
import { BaseException, Kw, RuntimeError, clock, toJSON } from './py.ts'

export type Recording = {
  request: Record<string, unknown>
  response?: unknown
  error?: { message: string; status?: number | null }
}
/** The tape the running grade replays, and how long upstream's retries
 * asked to wait since the last recorded call. */
export const session = { tape: [] as Recording[], cursor: 0, delay: 0 }
/** A grade's next judge call: not an `Exception`, so no grader's `except
 * Exception` around its judge call catches it. */
export class JudgeRequest extends BaseException {
  readonly request: Record<string, unknown>
  readonly delay: number
  constructor(request: Record<string, unknown>, delay: number) {
    super('judge request')
    this.request = request
    this.delay = delay
  }
}
export class ReplayMismatch extends BaseException {}

clock.sleep = (seconds: number) => {
  // Recorded attempts already waited; a new one waits once, outside the grade.
  if (session.cursor === session.tape.length) session.delay += seconds
}

/** A reply as upstream's client returns it: attributes, not keys. */
function objects(value: any): any {
  if (Array.isArray(value)) return value.map(objects)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, objects(v)]))
  return value
}
function create(args: any[]) {
  const values = args.length && args[args.length - 1] instanceof Kw ? (args[args.length - 1] as Kw).values : {}
  const request = toJSON(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, toJSON(v)])))
  if (session.cursor === session.tape.length) throw new JudgeRequest(request, session.delay)
  const entry = session.tape[session.cursor++]!
  if (JSON.stringify(entry.request) !== JSON.stringify(request))
    throw new ReplayMismatch(`Judge request ${session.cursor} differs from recording`)
  if (entry.error) {
    const error = new RuntimeError(entry.error.message) as RuntimeError & { status_code?: unknown }
    error.status_code = entry.error.status ?? null
    throw error
  }
  const response = structuredClone(entry.response) as any
  for (const choice of response?.choices ?? [])
    if (choice?.message && typeof choice.message === 'object' && !('content' in choice.message)) choice.message.content = null
  return objects(response)
}
/** `OpenAI(api_key=..., base_url=...)`: the endpoint and key are the
 * transport's (judge.ts), never the grade's. */
export class OpenAI {
  chat = { completions: { create: (...args: any[]) => create(args) } }
  constructor(..._args: any[]) {}
}
