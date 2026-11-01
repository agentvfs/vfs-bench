import { type Grader, grade } from '../../../workspace/grader.ts'
import { Social } from '../graders/social.ts'
export const grader: Grader = (c) => {
    const s = new Social(c),
      user = s.login('alice')
    if (user === null) return grade(0)
    const p = s.list(user).find((p) => p.id === 1)
    return grade(p ? (p.liked ? 0 : 0.5) + (p.like_count === 0 ? 0.5 : 0) : 0)
  }
