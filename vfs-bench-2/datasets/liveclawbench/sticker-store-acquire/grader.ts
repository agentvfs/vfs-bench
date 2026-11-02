import { type Grader, eq } from '../../../workspace/grader.ts'
import { CHAT_DB, acquired } from '../graders/chat.ts'
export const grader: Grader = (c) => {
  const packs = acquired(c)
  const count = c
    .rows(CHAT_DB, 'user_sticker')
    .filter((r) => eq(r.user_id, 1) && [1, 2].includes(r.pack_id)).length
  const cats = packs.has(1),
    space = packs.has(2)
  return {
    score: cats && space && count >= 6 ? 1 : (cats || space) && count >= 3 ? 0.5 : 0,
    checks: { cute_cats_acquired: cats, space_adventure_acquired: space, at_least_six_stickers: count >= 6 },
  }
}
