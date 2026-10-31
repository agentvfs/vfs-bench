import { type Grader } from '../../../workspace/grader.ts'
import { purchase } from '../graders/shop-weather.ts'
export const grader: Grader = (c) => purchase(c, 'prod_0074')
