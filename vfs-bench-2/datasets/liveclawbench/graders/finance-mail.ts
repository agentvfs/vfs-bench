import { dimensions, lower, round } from '../../../workspace/grader.ts'
export const finish = (d: Record<string, number>) =>
  dimensions(
    d,
    round(
      Object.values(d).reduce((a, b) => a + b, 0),
      2
    )
  )
export function amounts(text: string, keyword: string, radius = 300): number[] {
  const out: number[] = []
  let from = 0
  const hay = lower(text),
    needle = lower(keyword)
  while (true) {
    const i = hay.indexOf(needle, from)
    if (i < 0) break
    from = i + needle.length
    const context = text.slice(Math.max(0, i - radius), Math.min(text.length, i + needle.length + radius))
    for (const m of context.matchAll(/\$?\s*([\d,]+\.\d{2})/g)) out.push(Number(m[1]!.replaceAll(',', '')))
  }
  return out
}
