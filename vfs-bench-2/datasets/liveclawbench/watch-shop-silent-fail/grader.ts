import { type Grader } from '../../../workspace/grader.ts'
import { watch } from '../graders/shop-weather.ts'
export const grader: Grader = (c) => watch(c, false)
