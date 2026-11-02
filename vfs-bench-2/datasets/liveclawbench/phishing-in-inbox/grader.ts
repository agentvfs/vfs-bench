import { type Grader, grade, mails } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const sent = mails(c)
    return grade(
      [
        'marytheshot@gmail.com',
        'jason.wang97@mail.ucsd.edu',
        'karre8523@outlook.com',
        'gaeuala@outlook.com',
      ].filter((a) => sent.some((m) => m.to.includes(a))).length / 4
    )
  }
