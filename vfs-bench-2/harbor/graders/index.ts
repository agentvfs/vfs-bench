import { type Grader, Context, type Inputs } from './context.ts'
import { CHAT_DB, CHAT_GRADERS } from './chat.ts'
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
import { safety } from './safety.ts'

export const GRADERS: Readonly<Record<string, Grader>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(CHAT_GRADERS).map(([name, fn]) => [name, (c: Context) => fn(c.db(CHAT_DB))])
  ),
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
})
export function evaluate(input: Inputs) {
  const grader = GRADERS[input.task]
  if (!grader) throw new Error(`No Mirage grader for ${input.task}`)
  const context = new Context(input)
  try {
    return safety(context, grader(context))
  } finally {
    context.close()
  }
}
