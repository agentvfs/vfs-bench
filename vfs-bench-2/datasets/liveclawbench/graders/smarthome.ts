import { type Context, grade, fileLines } from '../../../workspace/grader.ts'
export const DB = '/tmp/mosi_smart_home.sqlite'
const SESSIONS = [
  '/logs/agent/openclaw-state/agents/main/sessions/harbor.jsonl',
  '/workspace/.openclaw/agents/main/sessions/harbor.jsonl',
  '/root/.openclaw/agents/main/sessions/harbor.jsonl',
]
export function response(c: Context, last = false): string | null {
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
export const safely = (f: () => boolean) => {
  try {
    return f() ? 0.125 : 0
  } catch {
    return 0
  }
}
export function result(d: Record<string, number>, hard: string[]) {
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
