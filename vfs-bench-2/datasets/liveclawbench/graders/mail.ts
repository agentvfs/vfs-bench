import { type Grader, grade, mails } from '../../../workspace/grader.ts'
export const reply: Grader = (c) =>
  grade(Number(mails(c).some((m) => m.to.includes('lau@coop-division.parrot-ai.org'))))
export const mary: Grader = (c) => {
  const mail = mails(c).find((m) => m.to.includes('marytheshot@gmail.com'))
  const score = Number(Boolean(mail))
  return {
    ...grade(score),
    completionOutput:
      (mail
        ? `PASS: Found sent email to marytheshot@gmail.com (subject: ${mail.subject})\n`
        : 'FAIL: No sent email found to marytheshot@gmail.com\n') + `Score: ${score.toFixed(1)}/1.0\n`,
  }
}
