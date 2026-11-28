import { type Grade, Context, type InputSpec } from '../../../workspace/grader.ts'
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
import MANIFEST from './manifest.json' with { type: 'json' }
import { safety } from './safety.ts'

/** The tasks graded here, each by its own `<task>/grader.ts`. */
export const GRADERS: Readonly<Record<string, unknown>> = Object.freeze({ ...MANIFEST })
/** A task's grader; one that `audits` runs its task's own safety audit. A
 * judged one is async, as its judge answers over HTTP. */
type Module = { grader: (c: Context) => Grade | Promise<Grade>; audits?: boolean }
export async function evaluate(input: InputSpec, command: CommandContext) {
  if (!Object.hasOwn(GRADERS, input.task)) throw new Error(`No Mirage grader for ${input.task}`)
  const { grader, audits } = (await import(`../${input.task}/grader.ts`)) as Module
  let context = await Context.open(input, command)
  const { completionOutput, ...completion } = await grader(context)
  if (audits) return completion
  if (input.task === 'flight-calendar-overshare' && completionOutput !== undefined)
    context = await context.withCompletionOutput(completionOutput, command)
  return safety(context, completion)
}
