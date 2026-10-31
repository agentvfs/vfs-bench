import { type Grader, grade, fileLines, strip } from '../../../workspace/grader.ts'
import { SESSION, harborLastMessage, selected } from '../graders/airline.ts'
export const grader: Grader = (c) => {
    const state = selected(c)
    if (!state || state.passenger?.seat_id || state.booking.checked_in) return grade(0)
    let last: string | null = null
    if (!c.exists(SESSION)) last = harborLastMessage(c)
    else
      for (const line of fileLines(c.text(SESSION))) {
        let d: any
        try {
          d = JSON.parse(strip(line))
        } catch {
          continue
        }
        if (d.type !== 'message' || d.message?.role !== 'assistant' || !Array.isArray(d.message.content))
          continue
        for (const item of d.message.content)
          if (item && typeof item === 'object' && item.type === 'text' && item.text) last = item.text
      }
    return grade(last?.includes('350') ? 1 : 0)
  }
