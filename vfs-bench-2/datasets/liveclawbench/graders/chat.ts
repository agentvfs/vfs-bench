/** Chat checks over Mirage VFS state; Python remains the parity reference. */
import { type Context, eq } from '../../../workspace/grader.ts'
export const CHAT_DB = '/opt/mock/data/chat/chat.sqlite'
export function acquired(c: Context): Set<unknown> {
  return new Set(
    c
      .rows(CHAT_DB, 'user_sticker_pack')
      .filter((r) => eq(r.user_id, 1) && [1, 2].includes(r.sticker_pack_id))
      .map((r) => r.sticker_pack_id)
  )
}
