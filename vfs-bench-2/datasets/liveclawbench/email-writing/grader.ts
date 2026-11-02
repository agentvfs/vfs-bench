import { type Grader, grade, mails } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => grade(Number(mails(c, false).some((m) => m.to.includes('mary.lee@work.mosi.inc'))))
