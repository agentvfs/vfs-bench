import { type Grader, GWS, dimensions, mails, mailText, round } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const targets = ['VectorDB Cloud row-level ACLs', 'OpenBrowse persistent sessions', 'NovaStack Series A']
    const digest = c.text('/workspace/notes/newsletter-digest.md', '')
    const bodies = c.exists(GWS)
      ? mails(c)
          .filter((m) => m.to.includes('research@work.mosi.inc'))
          .map(mailText)
      : []
    const hits = (s: string) => targets.filter((t) => s.includes(t)).length
    return dimensions({
      digest_score: round(hits(digest) * (0.4 / 3), 3),
      email_score: round(Math.max(0, ...bodies.map(hits)) * (0.4 / 3), 3),
      distractor_score: [digest, ...bodies].some((s) => s.includes('April mascot giveaway')) ? 0 : 0.2,
    })
  }
