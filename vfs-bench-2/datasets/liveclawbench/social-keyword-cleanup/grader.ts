import { type Grader, grade, round } from '../../../workspace/grader.ts'
import { Social } from '../graders/social.ts'
export const grader: Grader = (c) => {
    const s = new Social(c),
      user = s.login('mosi_brand')
    if (user === null) return grade(0)
    const posts = s.list(user, 1, true, 100),
      count = [9, 101, 102, 201, 202, 205].filter((id) =>
        posts.some((p) => p.id === id && p.status === 'deleted')
      ).length
    return grade(
      round(
        count * 0.1 + (count === 6 && posts.some((p) => p.id === 103 && p.status === 'published') ? 0.4 : 0),
        1
      )
    )
  }
