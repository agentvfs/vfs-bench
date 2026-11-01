import { type Grader, grade } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    if (!c.exists('/tmp/mosi_shop_user.json')) return grade(0)
    const data = c.json('/tmp/mosi_shop_user.json'),
      users = Array.isArray(data) ? data : [data]
    const address = users.every((u) => u.address === '4278 Maple View Drive, Sacramento, CA 95814, USA')
    const phone = users.every((u) => u.phone === 12345678901 || u.phone === '12345678901')
    return grade(address && phone ? 1 : address || phone ? 0.5 : 0)
  }
