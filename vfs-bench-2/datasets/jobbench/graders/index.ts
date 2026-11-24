import { type Grade, Context, type InputSpec } from '../../../workspace/grader.ts'
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
import MANIFEST from './manifest.json' with { type: 'json' }
import { grader } from './judge.ts'

/** The tasks graded here, all by upstream's one judge (judge.ts). */
export const GRADERS: Readonly<Record<string, unknown>> = Object.freeze({ ...MANIFEST })
export async function evaluate(input: InputSpec, command: CommandContext): Promise<Grade> {
  if (!Object.hasOwn(GRADERS, input.task)) throw new Error(`No Mirage grader for ${input.task}`)
  return grader(await Context.open(input, command))
}
