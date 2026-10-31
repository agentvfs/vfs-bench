/**
 * The chat fake's fixture: upstream's chat seed (mocks/chat/src/data/seed.ts),
 * which is the same for every task, as its rows and its sticker files.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/** Upstream's tables, parents first, so each row's references exist. */
const TABLES = ['mock_user', 'channel', 'message', 'sticker_pack', 'user_sticker', 'user_sticker_pack']

export async function chat(mock: string): Promise<Record<string, unknown[]>> {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-chat-seed-'))
  const stickerDir = join(dir, 'stickers')
  mkdirSync(stickerDir)
  const dbPath = join(dir, 'chat.sqlite')
  const { seed } = (await import(join(mock, 'src', 'data', 'seed.ts'))) as {
    seed: (db: Database, config: { dbPath: string; stickerDir: string }) => void
  }
  const db = new Database(dbPath, { create: true })
  db.run('PRAGMA foreign_keys = ON')
  seed(db, { dbPath, stickerDir })
  const out: Record<string, unknown[]> = {}
  for (const table of TABLES) out[table] = db.query(`SELECT * FROM ${table} ORDER BY id`).all()
  // Each sticker's file, which the fake keeps in `_sticker_file`.
  out._sticker_file = (out.user_sticker as { storage_path: string; mime_type: string }[]).map((row) => ({
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    data: readFileSync(join(stickerDir, basename(row.storage_path))).toString('base64'),
  }))
  db.close()
  rmSync(dir, { recursive: true, force: true })
  return out
}
