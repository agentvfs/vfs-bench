import { type Grader, eq, SOCIAL, grade } from '../../../workspace/grader.ts'
export const grader: Grader = (c) =>
    grade(c.rows(SOCIAL, 'post_like').filter((r) => eq(r.post_id, 1) && eq(r.account_id, 2))[0] ? 0 : 1)
