import { type Grader, grade } from '../../../workspace/grader.ts'
import { Social } from '../graders/social.ts'
export const grader: Grader = (c) => {
    const s = new Social(c)
    return grade(
      s.login('alice') !== null && s.list(null).some((p) => p.content === 'Hello from the test!') ? 1 : 0
    )
  }
