import { type Grader, grade } from '../../../workspace/grader.ts'
// Upstream's verifier's offline ground truths, which it uses when it
// cannot fetch the page, as in an offline workspace.
export const grader: Grader = (c) => {
    let r: any
    try {
      r = c.json('/workspace/output/aqi_report.json')
    } catch {
      return grade(0)
    }
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return grade(0)
    return grade(
      r.city === '北京'
        ? r.aqi === 75 && r.category === 'moderate'
          ? 1
          : r.aqi === 75 || r.category === 'moderate'
          ? 0.5
          : 0
        : 0
    )
  }
