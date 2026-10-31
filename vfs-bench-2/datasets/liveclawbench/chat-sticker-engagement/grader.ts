import { type Grader, eq, ne } from '../../../workspace/grader.ts'
import { CHAT_DB, acquired } from '../graders/chat.ts'
export const grader: Grader = (c) => {
  const packs = acquired(c)
  const channels = new Set(
    c
      .rows(CHAT_DB, 'message')
      .filter((r) => r.sender === 'You' && r.message_kind === 'sticker' && [2, 3].includes(r.channel_id))
      .map((r) => r.channel_id)
  )
  const cats = c.rows(CHAT_DB, 'user_sticker').filter((r) => eq(r.pack_id, 1))
  const checks = {
    acquired_both_packs: packs.has(1) && packs.has(2),
    sticker_in_both_channels: channels.has(2) && channels.has(3),
    cat_stickers_favorite: cats.length > 0 && !cats.some((r) => ne(r.category, 'favorite')),
  }
  const passed = Object.values(checks).filter(Boolean).length
  return { score: passed === 3 ? 1 : passed === 2 ? 0.5 : 0, checks }
}
