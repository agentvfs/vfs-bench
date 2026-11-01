import { type Grader, GWS, containsAny, dimensions, lines, lower, mails, mailText } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const texts = c.exists(GWS)
      ? mails(c)
          .filter((m) => m.to.includes('ops@work.mosi.inc'))
          .map(mailText)
      : []
    const escalation_score = Math.max(
      0,
      ...texts.map((t) => {
        t = lower(t)
        return t.includes('blueharbor') && t.includes('contract redline')
          ? 0.4
          : containsAny(t, ['blueharbor', 'contract redline'])
          ? 0.2
          : 0
      })
    )
    const seed = new Set(lines(c.text('/tests/_seed_snapshots/client-escalation-log.md', '')))
    const current = lines(c.text('/workspace/notes/client-escalation-log.md', ''))
    const log_score = Math.max(
      0,
      ...current
        .filter((l) => !seed.has(l))
        .map((l) => {
          l = lower(l)
          return l.includes('blueharbor') && l.includes('contract redline')
            ? l.includes('2026-04-03')
              ? 0.4
              : 0.2
            : 0
        })
    )
    const preservation_score =
      seed.size > 0 &&
      [...seed].every((l) => current.includes(l)) &&
      !texts.some((t) => /nimbus data|stratoscape|market[- ]pulse|colin@work\.mosi\.inc/i.test(t))
        ? 0.2
        : 0
    return dimensions({ escalation_score, log_score, preservation_score })
  }
