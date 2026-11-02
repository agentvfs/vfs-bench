import { type Grader, eq, containsAny, lower } from '../../../workspace/grader.ts'
import { DB, response, safely, result } from '../graders/smarthome.ts'
export const grader: Grader = (c) => {
    const text = lower(response(c)),
      sentences = text.split(/[.!?\n]/),
      d: Record<string, number> = {}
    d.D1 = safely(() => {
      const r = c.rows(DB, 'thermostat_settings').filter((r) => eq(r.id, 1))[0]
      return r?.mode === 'comfort' && r.temperature >= 72 && r.temperature <= 77
    })
    d.D2 = safely(() => {
      const r = c.rows(DB, 'coffee_schedule').filter((r) => eq(r.id, 1))[0]
      return Boolean(r) && r!.start_time <= '06:30'
    })
    d.D3 = safely(() => {
      const r = c
        .rows(DB, 'grocery_product')
        .find((r) => lower(r.name).includes('blue mountain') && lower(r.name).includes('coffee'))
      return Boolean(r) && r!.quantity >= 18 && r!.quantity <= 22 && lower(r!.reference).includes('expire')
    })
    d.D4 = safely(() => {
      const r = c.rows(DB, 'grocery_product').find((r) => lower(r.name).includes('kenya'))
      return (
        Boolean(r) &&
        r!.quantity >= 7 &&
        r!.quantity <= 9 &&
        containsAny(lower(r!.reference), ['insufficient', 'shortage'])
      )
    })
    const humidity =
      text.includes('999') ||
      (text.includes('humidity') && containsAny(text, ['anomaly', 'malfunction', 'sensor']))
    const causal = sentences.some(
      (s) =>
        containsAny(s, ['humidity', 'sensor', '999']) &&
        s.includes('thermostat') &&
        containsAny(s, [
          'caused',
          'cause',
          'trigger',
          'triggered',
          'led to',
          'resulted in',
          'protection mode',
          'corrupted',
          'because of',
          'due to',
        ])
    )
    const fixed = text.includes('thermostat') && containsAny(text, ['comfort', 'corrected', 'fix', 'adjust'])
    d.D5 = humidity && causal && fixed ? 0.125 : 0
    d.D6 =
      text.includes('30') &&
      containsAny(text, ['min', 'minute']) &&
      containsAny(text, ['06:30', '6:30']) &&
      sentences.some(
        (s) =>
          containsAny(s, ['30', 'brew']) && containsAny(s, ['7', '07:', 'leave', 'departure', 'ready by'])
      )
        ? 0.125
        : 0
    const blue = text.includes('blue mountain') && containsAny(text, ['expired', 'expire']),
      kenya = text.includes('kenya') && containsAny(text, ['insufficient', 'shortage', '12', 'not enough'])
    d.D7 = blue && kenya ? 0.125 : blue || kenya ? 0.0625 : 0
    d.D8 =
      text.includes('kenya') && text.includes('coffee')
        ? containsAny(text, ['cross', 'reference', 'machine', 'bean'])
          ? 0.125
          : 0.0625
        : 0
    return result(d, ['D1', 'D2', 'D3', 'D4'])
  }
