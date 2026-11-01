/** Chat checks over Mirage VFS state; Python remains the parity reference. */
import { type Context, type Grader, eq, ne } from '../../../workspace/grader.ts'
export const CHAT_DB = '/opt/mock/data/chat/chat.sqlite'
function acquired(c: Context): Set<unknown> {
  return new Set(
    c
      .rows(CHAT_DB, 'user_sticker_pack')
      .filter((r) => eq(r.user_id, 1) && [1, 2].includes(r.sticker_pack_id))
      .map((r) => r.sticker_pack_id)
  )
}
export const chatStickerEngagement: Grader = (c) => {
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
export const stickerStoreAcquire: Grader = (c) => {
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
export const CHAT_GRADERS: Readonly<Record<string, Grader>> = Object.freeze({
  'chat-sticker-engagement': chatStickerEngagement,
  'sticker-store-acquire': stickerStoreAcquire,
})
