import {
  eq,
  like,
  type Context,
  type Grader,
  containsAny,
  grade,
  fileLines,
  lower,
  round,
} from './context.ts'
const DB = '/tmp/mosi_smart_home.sqlite'
const SESSIONS = [
  '/logs/agent/openclaw-state/agents/main/sessions/harbor.jsonl',
  '/workspace/.openclaw/agents/main/sessions/harbor.jsonl',
  '/root/.openclaw/agents/main/sessions/harbor.jsonl',
]
function response(c: Context, last = false): string | null {
  const paths = last ? [SESSIONS[1]!, SESSIONS[2]!, SESSIONS[0]!] : SESSIONS
  const path = paths.find((p) => c.exists(p))
  if (!path)
    return c.exists('/workspace/output/response.txt') ? c.text('/workspace/output/response.txt') : null
  const contents: string[] = []
  for (const line of fileLines(c.text(path))) {
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type !== 'message' || e.message?.role !== 'assistant') continue
    const v = e.message.content
    if (v == null) continue
    if (typeof v === 'string') contents.push(v)
    else if (Array.isArray(v)) {
      const parts = v.filter((p) => p.type === 'text' && p.text).map((p) => p.text)
      if (last || parts.length) contents.push(parts.join(' '))
    }
  }
  return contents.length ? (last ? contents.at(-1)! : contents.join(' ')) : null
}
const safely = (f: () => boolean) => {
  try {
    return f() ? 0.125 : 0
  } catch {
    return 0
  }
}
function result(d: Record<string, number>, hard: string[]) {
  const score = Object.values(d).reduce((a, b) => a + b, 0)
  return {
    ...grade(score, d),
    rewards: {
      reward: score,
      ...Object.fromEntries(Object.entries(d).map(([k, v]) => ['_meta_' + k, v])),
      _meta_passed_count: Object.values(d).filter((v) => v >= 0.125).length,
      _meta_hard_required_pass: Number(hard.every((k) => d[k]! >= 0.125)),
    },
  }
}
export const SMARTHOME_GRADERS: Record<string, Grader> = {
  'grocery-reorder': (c) => {
    const eggRow =
      c
        .rows(DB, 'grocery_product')
        .filter(
          (r) =>
            (like(r.name, '%egg%') || like(r.product_id, '%egg%')) &&
            eq(r.quantity, 36.0) &&
            eq(r.unit, 'pieces')
        )[0] ??
      c
        .rows(DB, 'grocery_product')
        .filter(
          (r) =>
            (like(r.name, '%egg%') || like(r.product_id, '%egg%')) &&
            eq(r.quantity, 3.0) &&
            eq(r.unit, 'dozen')
        )[0]
    const egg = eggRow?.product_id
    let orders: any[] = []
    try {
      orders = c.json('/tmp/mosi_shop_orders.json')
    } catch {}
    const order = orders.find((o) =>
      (o.items ?? []).some(
        (i: any) =>
          (lower(i.product_id).includes('egg') || lower(i.title).includes('egg')) && i.quantity === 3
      )
    )
    const d1 = egg != null,
      d2 = order !== undefined,
      d3 =
        d1 &&
        order?.order_id != null &&
        c.rows(DB, 'grocery_product').filter((r) => eq(r.product_id, egg))[0]?.reference === order.order_id
    const text = lower(response(c, true)),
      d4 =
        containsAny(text, ['round', 'rounding', 'convert', 'conversion', 'adjust', 'up to', 'instead of']) ||
        (text.includes('dozen') && text.includes('only') && (/\b3\b/.test(text) || text.includes('three')))
    let d5 = false
    if (d1 && d2 && d3)
      d5 = (
        [
          ['PROD001', 'gallon', 'ORD000001'],
          ['PROD002', 'lb', 'ORD000002'],
        ] as const
      ).every(([id, unit, ref]) => {
        const r = c.rows(DB, 'grocery_product').filter((r) => eq(r.product_id, id))[0]
        return r?.quantity === 1 && r.unit === unit && r.reference === ref
      })
    const score = round(
      (d1 ? 0.25 : 0) + (d2 ? 0.25 : 0) + (d3 ? 0.25 : 0) + (d4 ? 0.15 : 0) + (d5 ? 0.1 : 0),
      2
    )
    return {
      ...grade(score, { D1: d1, D2: d2, D3: d3, D4: d4, D5: d5 }),
      rewards: { reward: score },
      artifacts: {
        'reward_details.json': {
          _meta_dimensions: {
            D1: d1 ? 'PASS' : 'FAIL',
            D2: d2 ? 'PASS' : 'FAIL',
            D3: d3 ? 'PASS' : 'FAIL',
            D4: d4 ? 'PASS' : 'FAIL',
            D5: d5 ? 'PASS' : 'SKIPPED',
          },
        },
      },
    }
  },
  'morning-comfort-setup': (c) => {
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
  },
  'smarthome-test': (c) => {
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
  },
}
