import { type Grader, grade, round } from '../../../workspace/grader.ts'
import { financePath, near } from '../graders/finance.ts'
export const grader: Grader = (c) => {
    let score = 0
    try {
      const db = financePath(c),
        holdings = new Map(c.rows(db, 'portfolio_holding').map((r) => [r.asset_class_code, r.current_value]))
      if (
        Object.entries({ eq: 112500, fi: 75000, ca: 37500, al: 25000 }).every(([k, v]) =>
          near(holdings.get(k), v, 1)
        )
      )
        score = 1
      else {
        const seed = new Set(['eq,buy,5000', 'fi,sell,3000', 'al,buy,2000'])
        const orders = c
          .rows(db, 'portfolio_order')
          .filter((o) => !seed.has([o.asset_class_code, o.direction, o.amount].join(',')))
        score =
          (
            [
              ['eq', 'buy', 12500],
              ['fi', 'sell', 5000],
              ['ca', 'sell', 12500],
              ['al', 'buy', 5000],
            ] as const
          ).filter(([code, dir, value]) =>
            orders.some((o) => o.asset_class_code === code && o.direction === dir && near(o.amount, value, 1))
          ).length / 4
      }
    } catch {}
    return {
      ...grade(score),
      rewards: {
        reward: round(score, 2),
        holdings_correct: score === 1 ? 1 : 0,
        ...(score < 1 ? { orders_score: round(score, 2) } : {}),
      },
    }
  }
