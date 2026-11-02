import { type Grader, orderBy, round } from '../../../workspace/grader.ts'
import { finance } from '../graders/finance.ts'
export const grader: Grader = (c) =>
    finance(c, (d, db) => {
      const rows = c.rows(db, 'transaction_record').sort(orderBy(['id', 1]))
      if (!rows.length) return
      const flagged = new Set(rows.filter((r) => r.status === 'flagged').map((r) => r.id)),
        hits = [8, 9, 10, 11].filter((id) => flagged.has(id)).length
      d.anomaly_detection = round((0.4 * hits) / 4, 4)
      d.no_false_positives = flagged.size && ![1, 2, 3, 4, 5, 6, 7].some((id) => flagged.has(id)) ? 0.3 : 0
      d.no_false_negatives = hits === 4 ? 0.3 : 0
    })
