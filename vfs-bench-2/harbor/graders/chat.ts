/** Ports of the two committed chat verify.py files. Keep their SQL and scoring. */
import type { DatabaseSync } from 'node:sqlite'

export const CHAT_DB = '/opt/mock/data/chat/chat.sqlite'

export interface Grade {
  score: number
  checks: Record<string, boolean>
}

function acquired(db: DatabaseSync): Set<unknown> {
  return new Set(
    db
      .prepare(
        'SELECT sticker_pack_id FROM user_sticker_pack WHERE user_id = 1 AND sticker_pack_id IN (1, 2)'
      )
      .all()
      .map((row) => row.sticker_pack_id)
  )
}

export function chatStickerEngagement(db: DatabaseSync): Grade {
  const packs = acquired(db)
  const channels = new Set(
    db
      .prepare(
        "SELECT channel_id FROM message WHERE sender = 'You' AND message_kind = 'sticker' AND channel_id IN (2, 3)"
      )
      .all()
      .map((row) => row.channel_id)
  )
  // Deliberately no user_id filter: the reference grader checks every row
  // of pack 1, and SQL's NULL behaviour is part of that check too.
  const notFavorite = db
    .prepare("SELECT COUNT(*) as cnt FROM user_sticker WHERE pack_id = 1 AND category != 'favorite'")
    .get()!.cnt
  const totalCat = db.prepare('SELECT COUNT(*) as cnt FROM user_sticker WHERE pack_id = 1').get()!.cnt
  const checks = {
    acquired_both_packs: packs.has(1) && packs.has(2),
    sticker_in_both_channels: channels.has(2) && channels.has(3),
    cat_stickers_favorite: Number(totalCat) > 0 && notFavorite === 0,
  }
  const passed = Object.values(checks).filter(Boolean).length
  return { score: passed === 3 ? 1 : passed === 2 ? 0.5 : 0, checks }
}

export function stickerStoreAcquire(db: DatabaseSync): Grade {
  const packs = acquired(db)
  const count = Number(
    db.prepare('SELECT COUNT(*) as cnt FROM user_sticker WHERE user_id = 1 AND pack_id IN (1, 2)').get()!.cnt
  )
  const cats = packs.has(1)
  const space = packs.has(2)
  return {
    score: cats && space && count >= 6 ? 1 : (cats || space) && count >= 3 ? 0.5 : 0,
    checks: { cute_cats_acquired: cats, space_adventure_acquired: space, at_least_six_stickers: count >= 6 },
  }
}

export const CHAT_GRADERS: Readonly<Record<string, (db: DatabaseSync) => Grade>> = Object.freeze({
  'chat-sticker-engagement': chatStickerEngagement,
  'sticker-store-acquire': stickerStoreAcquire,
})
