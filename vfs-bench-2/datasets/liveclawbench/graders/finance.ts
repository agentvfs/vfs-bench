import { type Context, FINANCE, dimensions, round } from '../../../workspace/grader.ts'
export const financePath = (c: Context) => c.input.env?.MOCK_FINANCE_DB_PATH ?? FINANCE
export function finance(c: Context, fn: (d: Record<string, number>, db: string) => void) {
  const d: Record<string, number> = {}
  try {
    if (c.exists(financePath(c))) fn(d, financePath(c))
  } catch {}
  return dimensions(
    d,
    round(
      Object.values(d).reduce((a, b) => a + b, 0),
      2
    )
  )
}
export const near = (a: any, b: number, tolerance = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tolerance
