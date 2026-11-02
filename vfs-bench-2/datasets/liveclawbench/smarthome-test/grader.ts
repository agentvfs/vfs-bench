import { type Grader, eq, like, containsAny, lower } from '../../../workspace/grader.ts'
import { DB, response, safely, result } from '../graders/smarthome.ts'
export const grader: Grader = (c) => {
    const text = lower(response(c)),
      d: Record<string, number> = {},
      partial = (n: number, max = 2) => (n === max ? 0.125 : n === max - 1 ? 0.083 : 0)
    d.D1 = partial(
      Number(/68\.5|68\s*°|68\s*degrees|68\s*f/.test(text)) +
        Number(/52\s*%|humidity[^\d]*52|52[^\d]*humidity/.test(text)) +
        Number(/\beco\b/.test(text) || text.includes('eco mode')),
      3
    )
    d.D2 = partial(
      Number(containsAny(text, ['07:00', '7:00', '7am'])) +
        Number(containsAny(text, ['ready', 'brewing', 'preparing', 'scheduled']))
    )
    d.D3 = safely(() => {
      const r = c.rows(DB, 'thermostat_settings').filter((r) => eq(r.id, 1))[0]
      return r?.mode === 'comfort' && r.temperature === 74
    })
    const fridge = /8\s*items?\s*(in\s*)?(the\s*)?fridge|fridge[^\d]*8\s*items?|fridge[^\d.]*:\s*8/.test(
        text
      ),
      pantry = /5\s*items?\s*(in\s*)?(the\s*)?pantry|pantry[^\d]*5\s*items?|pantry[^\d.]*:\s*5/.test(text)
    d.D4 = partial(Number(fridge) + Number(pantry))
    const expiring = ['milk', 'bread', 'chicken breast', 'tomatoes', 'yogurt', 'cheese'],
      found = expiring.filter((n) => text.includes(n)).length
    d.D5 = found === 6 ? 0.125 : found >= 4 ? 0.083 : 0
    const count = /\b4\s*events?|\bfour\s*events?/.test(text),
      titles = ['Morning Workout', 'Team Standup', 'Lunch with Client', 'Project Review'].filter((t) => {
        const l = lower(t),
          words = l.split(/\s+/).filter((w) => w.length > 4)
        return text.includes(l) || (words.length > 0 && words.every((w) => text.includes(w)))
      }).length
    d.D6 = count && titles === 4 ? 0.125 : count || titles >= 3 ? 0.083 : 0
    d.D7 = safely(() => {
      const r = c
        .rows(DB, 'calendar_event')
        .filter((r) => like(r.start_time, '2026-05-09%') && eq(r.event_type, 'workout'))[0]
      return r?.title === 'Morning Workout' && r.workout_type === 'walking'
    })
    d.D8 = safely(
      () =>
        c.rows(DB, 'grocery_product').length > 8 &&
        c
          .rows(DB, 'grocery_product')
          .slice(8)
          .some((r) => expiring.some((e) => lower(r.name).includes(e))) &&
        /expir|running\s*low|need.*shop|shop.*need/.test(text)
    )
    return result(d, ['D3', 'D7'])
  }
