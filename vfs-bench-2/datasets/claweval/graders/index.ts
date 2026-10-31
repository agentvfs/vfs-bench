/**
 * Claw-Eval's graders in the native verifier (`workspace/verify.ts`): each
 * task's own grader, ported (`grade.ts`), over the trial's frozen inputs,
 * which `verifier.py` stages:
 * - `/input/state.json`: the task, each service's audit, the gws fake's
 *   tables and the run's clock;
 * - `/input/trajectory.json`, `/input/dispatches.jsonl`: the agent's
 *   trajectory and its tool CLIs' calls, when it made them;
 * - `/input/gws_seed.json`: a gws task's gmail and calendar fixtures.
 */
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
import { Context, type Grade, type InputSpec } from '../../../workspace/grader.ts'
import { grade, JUDGE_MODEL } from './grade.ts'
import { judgeTransport } from './judge.ts'
import { TASKS } from './port/registry.ts'
import * as $ from './py.ts'

/** The tasks graded here: all 126. */
export const GRADERS: Readonly<Record<string, unknown>> = Object.freeze({ ...TASKS })

export async function evaluate(input: InputSpec, command: CommandContext): Promise<Grade> {
  if (!Object.hasOwn(GRADERS, input.task)) throw new Error(`No Mirage grader for ${input.task}`)
  const context = await Context.open(input, command)
  const file = (path: string) => (context.exists(path) ? context.text(path) : null)
  const state = $.json.loads(context.text('/input/state.json'))
  if ($.gi(state, 'task') !== input.task) throw new Error('Claw-Eval task/input identity mismatch')
  const env = input.env ?? {}
  const model = env.JUDGE_MODEL || JUDGE_MODEL
  const files = Object.fromEntries(input.files.map((path) => [path, context.text(path)]))
  const result = await grade(
    {
      task: input.task,
      model,
      audit: $.json.dumps($.gi(state, 'audit')),
      run: {
        trajectory: file('/input/trajectory.json'),
        dispatches: file('/input/dispatches.jsonl'),
        seed: file('/input/gws_seed.json'),
        gws: $.gi(state, 'gws'),
        epoch: $.gi(state, 'epoch'),
      },
    },
    judgeTransport(env),
    command.signal
  )
  return {
    score: result.score,
    checks: result.rewards,
    rewards: result.rewards,
    artifacts: {
      'reward_details.json': result.details,
      // What the grade read and the judge's replies, to grade it again
      // (tests/audit.py --job).
      'judge-recording.json': result.tape,
      'claweval-inputs.json': { task: input.task, model, files },
    },
  }
}
