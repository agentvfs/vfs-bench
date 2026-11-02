import { type Grader, grade } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const path = '/workspace/output/exercise_window.json'
    let r: any = {}
    try {
      r = c.json(path)
    } catch {}
    const integer = (key: string) => {
      try {
        return c.jsonInteger(path, key)
      } catch {
        return false
      }
    }
    const dim_start = integer('start_hour') && r.start_hour === 0 ? 0.4 : 0
    const dim_end = integer('end_hour') && r.end_hour === 9 ? 0.4 : 0
    const dim_duration = integer('duration_hours') && r.duration_hours === 10 ? 0.2 : 0
    const score = dim_start + dim_end + dim_duration
    return {
      ...grade(score),
      rewards: {
        reward: score,
        dim_start,
        dim_end,
        dim_duration,
        start_got: integer('start_hour') ? r.start_hour : -1,
        end_got: integer('end_hour') ? r.end_hour : -1,
        duration_got: integer('duration_hours') ? r.duration_hours : -1,
      },
    }
  }
