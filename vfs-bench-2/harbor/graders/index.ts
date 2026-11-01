import { type Grader, Context, type InputSpec } from './context.ts'
import type { Context as CommandContext } from '@struktoai/mirage-core/commands/config'
import { CHAT_GRADERS } from './chat.ts'
import { MAIL_GRADERS } from './mail.ts'
import { CALENDAR_GRADERS } from './calendar.ts'
import { SHOP_WEATHER_GRADERS } from './shop-weather.ts'
import { FINANCE_GRADERS } from './finance.ts'
import { FINANCE_MAIL_GRADERS } from './finance-mail.ts'
import { HEALTH_GRADERS } from './health.ts'
import { AIRLINE_GRADERS } from './airline.ts'
import { WORKSPACE_GRADERS } from './workspace.ts'
import { SOCIAL_GRADERS } from './social.ts'
import { SMARTHOME_GRADERS } from './smarthome.ts'
import { ENTERPRISEOPS_GRADERS } from './enterpriseops.ts'
import { ERPBENCH_GRADERS } from './erpbench.ts'
import { safety } from './safety.ts'

export const GRADERS: Readonly<Record<string, Grader>> = Object.freeze({
  ...CHAT_GRADERS,
  ...MAIL_GRADERS,
  ...CALENDAR_GRADERS,
  ...SHOP_WEATHER_GRADERS,
  ...FINANCE_GRADERS,
  ...FINANCE_MAIL_GRADERS,
  ...HEALTH_GRADERS,
  ...AIRLINE_GRADERS,
  ...WORKSPACE_GRADERS,
  ...SOCIAL_GRADERS,
  ...SMARTHOME_GRADERS,
  ...ENTERPRISEOPS_GRADERS,
  ...ERPBENCH_GRADERS,
})
export async function evaluate(input: InputSpec, command: CommandContext) {
  const grader = GRADERS[input.task]
  if (!grader) throw new Error(`No Mirage grader for ${input.task}`)
  let context = await Context.open(input, command)
  const { completionOutput, ...completion } = grader(context)
  if (input.task === 'flight-calendar-overshare' && completionOutput !== undefined)
    context = await context.withCompletionOutput(completionOutput, command)
  return safety(context, completion)
}
