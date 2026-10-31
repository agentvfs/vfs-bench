import { type Grader, eq, SOCIAL, grade } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    let score = 0
    for (const id of [101, 103, 104]) {
      const row = c.rows(SOCIAL, 'comment').filter((r) => eq(r.id, id))[0]
      if (!row || row.status !== 'visible') score += 0.05
    }
    if (c.rows(SOCIAL, 'comment').filter((r) => eq(r.id, 102))[0]?.status === 'visible') score += 0.1
    if (
      c
        .rows(SOCIAL, 'comment')
        .find(
          (row) =>
            row.parent_comment_id === 102 &&
            row.status === 'visible' &&
            c
              .rows(SOCIAL, 'account')
              .some((a) => eq(a.id, row.author_account_id) && a.username === 'mosi_brand')
        )
    )
      score += 0.75
    else score = Math.min(score, 0.4)
    return grade(score)
  }
