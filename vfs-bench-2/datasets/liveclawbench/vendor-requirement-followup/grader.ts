import { type Grader, GWS, dimensions, grade, lines, mails } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    if (!c.exists(GWS)) return grade(0)
    const sent = mails(c),
      tracker = c.text('/workspace/notes/requirements-tracker.md', '')
    const target = 'Phoenix Analytics pilot API scope'
    const tracker_score = Math.max(
      0,
      ...lines(tracker).map((l) => (l.includes(target) ? (l.includes('2026-04-03') ? 0.4 : 0.2) : 0))
    )
    const preserved = [
      'Atlas Logistics rate card — received 2026-03-22',
      'Nimbus Storage SLA addendum — received 2026-03-29',
    ].every((s) => tracker.includes(s))
    const distractor = sent.some((m) =>
      m.to.some((r) => ['partners@orchid-partners.com', 'finance@work.mosi.inc'].includes(r))
    )
    return dimensions({
      reply_score: sent.some((m) => m.to.includes('ops@orchid-systems.com')) ? 0.4 : 0,
      tracker_score,
      preservation_score: preserved && !distractor ? 0.2 : 0,
    })
  }
