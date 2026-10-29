/**
 * The chat fake's API: upstream's `routes/stickers.ts`, `routes/store.ts` and
 * `routes/chat.ts`, each statement kept, over the run's Prisma client.
 *
 * What a run cannot share with another is the kit's: `ctx.clock` for every
 * `new Date()` (frozen at the reset's epoch, a second per tick) and
 * `ctx.minter` for every `crypto.randomUUID()`, so the same calls make the
 * same rows in every run.
 */
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { MAX_FILE_SIZE, STORE_ASSETS, USER_ID } from './config.ts'
import type { C } from './config.ts'
import {
  CATEGORIES,
  type Category,
  categoryQuery,
  failure,
  isReply,
  json,
  jsonBody,
  mimeOf,
  positiveId,
  previews,
  rowId,
  stickerJson,
} from './wire.ts'

type Handler = (ctx: Ctx<C>) => Promise<Reply> | Reply

const UPLOAD_MIME = new Set(['image/gif', 'image/png', 'image/jpeg'])
const STICKER_PREFIX = '/static/chat/stickers/'

/** Upstream's `mimeToExt`. */
function extOf(mime: string): string {
  return { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg' }[mime] ?? 'bin'
}

/**
 * An upload's type as upstream's runtime reads it. Bun's `File.type` for a
 * multipart part ignores the part's Content-Type: it is the file name's
 * extension's type, or for a name with none, its first bytes'.
 */
function uploadType(name: string, bytes: Buffer): string {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return mimeOf(name)
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  return 'application/octet-stream'
}

/**
 * A sticker file's name where upstream draws `crypto.randomUUID()`: a
 * UUID-shaped counter from the run's minter, which every reset restarts.
 */
function fileName(ctx: Ctx<C>, ext: string): string {
  const n = ctx.minter.next('sticker')
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}.${ext}`
}

/** The highest `sort_order` in a category, or -1, as upstream's COALESCE reads it. */
async function maxSort(db: Pick<C, 'userSticker'>, category: string): Promise<number> {
  const { _max } = await db.userSticker.aggregate({ where: { category }, _max: { sort_order: true } })
  return _max.sort_order ?? -1
}

const STICKER_COLUMNS = {
  id: true,
  user_id: true,
  pack_id: true,
  category: true,
  storage_path: true,
  mime_type: true,
  created_at: true,
  sort_order: true,
} as const

function withId(param: string, handler: (ctx: Ctx<C>, id: number) => Promise<Reply> | Reply): Handler {
  return (ctx) => {
    const id = positiveId(param, ctx.params[param])
    return isReply(id) ? id : handler(ctx, id)
  }
}

// --- stickers ---

async function listStickers(ctx: Ctx<C>): Promise<Reply> {
  const category = categoryQuery(ctx.query.get('category'))
  if (isReply(category)) return category
  const rows = await ctx.db.userSticker.findMany({
    select: STICKER_COLUMNS,
    ...(category === undefined ? {} : { where: { category } }),
    orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }, { id: 'asc' }],
  })
  return json(200, { stickers: rows.map(stickerJson) })
}

async function getSticker(ctx: Ctx<C>, id: number): Promise<Reply> {
  const row = await ctx.db.userSticker.findUnique({ select: STICKER_COLUMNS, where: { id } })
  return row === null ? json(404, { error: 'not_found' }) : json(200, stickerJson(row))
}

async function uploadSticker(ctx: Ctx<C>): Promise<Reply> {
  const contentType = String(ctx.headers['content-type'] ?? '')
  if (!contentType.includes('multipart/form-data')) return json(400, { error: 'invalid_body' })
  let form: FormData
  try {
    const body = new Blob([new Uint8Array(ctx.body)])
    form = await new Request('http://chat/', { method: 'POST', headers: { 'content-type': contentType }, body }).formData()
  } catch {
    return json(400, { error: 'invalid_body' })
  }
  const file = form.get('file')
  const categoryRaw = form.get('category') ?? 'custom'
  if (file === null || typeof file === 'string') return json(400, { error: 'invalid_body' })
  if (typeof categoryRaw !== 'string' || !(CATEGORIES as readonly string[]).includes(categoryRaw)) {
    return json(400, { error: 'invalid_category' })
  }
  const category = categoryRaw as Category
  if (file.size === 0) return json(400, { error: 'empty_file' })
  if (file.size > MAX_FILE_SIZE) return json(413, { error: 'file_too_large' })
  const bytes = Buffer.from(await file.arrayBuffer())
  const type = uploadType(file.name, bytes)
  if (!UPLOAD_MIME.has(type)) return json(400, { error: 'unsupported_mime' })

  const storagePath = `${STICKER_PREFIX}${fileName(ctx, extOf(type))}`
  const data = bytes.toString('base64')
  const sortOrder = (await maxSort(ctx.db, category)) + 1
  const createdAt = ctx.clock.nowIso()
  const [row] = await ctx.db.$transaction([
    ctx.db.userSticker.create({
      data: { user_id: USER_ID, category, storage_path: storagePath, mime_type: type, created_at: createdAt, sort_order: sortOrder },
    }),
    ctx.db.stickerFile.create({ data: { storage_path: storagePath, mime_type: type, data } }),
  ])
  // Upstream builds this reply by hand, without `pack_id`.
  return json(201, {
    id: row.id,
    user_id: USER_ID,
    category,
    storage_path: storagePath,
    mime_type: type,
    created_at: createdAt,
    sort_order: sortOrder,
  })
}

/** The PATCH body upstream's `PatchStickerBodySchema` accepts, or undefined. */
function patchBody(body: unknown): { category?: Category; sort_order?: number } | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const { category, sort_order } = body as Record<string, unknown>
  if (category !== undefined && !(CATEGORIES as readonly unknown[]).includes(category)) return undefined
  if (sort_order !== undefined && !(typeof sort_order === 'number' && Number.isInteger(sort_order))) return undefined
  return {
    ...(category === undefined ? {} : { category: category as Category }),
    ...(sort_order === undefined ? {} : { sort_order }),
  }
}

async function patchSticker(ctx: Ctx<C>, id: number): Promise<Reply> {
  const sticker = await ctx.db.userSticker.findUnique({ select: STICKER_COLUMNS, where: { id } })
  if (sticker === null) return json(404, { error: 'not_found' })
  const parsed = patchBody(jsonBody(ctx.body))
  if (parsed === undefined) return json(400, { error: 'invalid_body' })
  const { category, sort_order } = parsed
  const current = sticker.category
  const target = category ?? current
  const moving = category !== undefined && category !== current

  // The slot the sticker lands in: clamped to the target category's
  // length, appended when only the category changes, or kept.
  let targetSort: number | null
  if (sort_order !== undefined) {
    const count = await ctx.db.userSticker.count({ where: moving ? { category: target, id: { not: id } } : { category: target } })
    targetSort = Math.max(0, Math.min(sort_order, count))
  } else if (moving) {
    targetSort = (await maxSort(ctx.db, target)) + 1
  } else {
    targetSort = sticker.sort_order
  }
  await ctx.db.userSticker.update({ where: { id }, data: { category: target, sort_order: targetSort } })

  // Then each affected category is renumbered from 0.
  const renumber = async (cat: string) => {
    const rows = await ctx.db.userSticker.findMany({ select: { id: true }, where: { category: cat }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] })
    return rows.map((row, i) => ctx.db.userSticker.update({ where: { id: row.id }, data: { sort_order: i } }))
  }
  await ctx.db.$transaction([...(moving ? await renumber(current) : []), ...(await renumber(target))])

  const updated = await ctx.db.userSticker.findUniqueOrThrow({ select: STICKER_COLUMNS, where: { id } })
  return json(200, stickerJson(updated))
}

async function deleteSticker(ctx: Ctx<C>, id: number): Promise<Reply> {
  const row = await ctx.db.userSticker.findUnique({ select: { storage_path: true }, where: { id } })
  if (row === null) return json(404, { error: 'not_found' })
  await ctx.db.$transaction([
    ctx.db.stickerFile.deleteMany({ where: { storage_path: row.storage_path } }),
    ctx.db.userSticker.delete({ where: { id } }),
  ])
  // Hono's `c.body(null, 204)` states its empty length, which the kit omits.
  return { status: 204, headers: { 'Content-Length': '0' } }
}

// --- store ---

async function listPacks(ctx: Ctx<C>): Promise<Reply> {
  const packs = await ctx.db.stickerPack.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] })
  const acquired = new Set(
    (await ctx.db.userStickerPack.findMany({ select: { sticker_pack_id: true }, where: { user_id: USER_ID } })).map(
      (r) => r.sticker_pack_id,
    ),
  )
  return json(200, {
    packs: packs.map((p) => ({
      id: p.id,
      title: p.title,
      provider_name: p.provider_name,
      previews: previews(p.previews_json).map((v) => ({ ...v })),
      acquired: acquired.has(p.id),
    })),
  })
}

async function acquirePack(ctx: Ctx<C>, id: number): Promise<Reply> {
  const pack = await ctx.db.stickerPack.findUnique({ select: { id: true, previews_json: true }, where: { id } })
  if (pack === null) return json(404, { error: 'not_found' })
  const acquiredAt = ctx.clock.nowIso()
  // Upstream copies each preview's art first, then inserts in one
  // transaction: the pack (once), and only on a new pack its stickers.
  const files = previews(pack.previews_json).map((preview) => ({
    storage_path: `${STICKER_PREFIX}${fileName(ctx, 'svg')}`,
    data: readFileSync(join(STORE_ASSETS, preview.filename)).toString('base64'),
  }))
  try {
    await ctx.db.$transaction(async (tx) => {
      const owned = await tx.userStickerPack.findUnique({
        where: { user_id_sticker_pack_id: { user_id: USER_ID, sticker_pack_id: id } },
      })
      if (owned !== null) return
      await tx.userStickerPack.create({ data: { user_id: USER_ID, sticker_pack_id: id, acquired_at: acquiredAt } })
      const offset = (await maxSort(tx, 'recent')) + 1
      for (const [i, file] of files.entries()) {
        await tx.userSticker.create({
          data: {
            user_id: USER_ID,
            pack_id: id,
            category: 'recent',
            storage_path: file.storage_path,
            mime_type: 'image/svg+xml',
            created_at: acquiredAt,
            sort_order: offset + i,
          },
        })
        await tx.stickerFile.create({ data: { ...file, mime_type: 'image/svg+xml' } })
      }
    })
  } catch {
    return json(500, { error: 'db_error' })
  }
  return json(200, { acquired: true })
}

// --- chat ---

async function listChannels(ctx: Ctx<C>): Promise<Reply> {
  const rows = await ctx.db.channel.findMany({ orderBy: { id: 'asc' } })
  return json(200, {
    channels: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      name: r.name,
      kind: r.kind,
      last_message_preview: r.last_message_preview,
      updated_at: r.updated_at,
      unread_count: r.unread_count,
    })),
  })
}

async function listMessages(ctx: Ctx<C>, id: number): Promise<Reply> {
  if ((await ctx.db.channel.findUnique({ select: { id: true }, where: { id } })) === null) {
    return json(404, { error: 'not_found' })
  }
  const rows = await ctx.db.message.findMany({ where: { channel_id: id }, orderBy: [{ sent_at: 'asc' }, { id: 'asc' }] })
  return json(200, {
    messages: rows.map((r) => ({
      id: r.id,
      channel_id: r.channel_id,
      sender: r.sender,
      body: r.body,
      sent_at: r.sent_at,
      message_kind: r.message_kind,
      source_ref: r.source_ref,
    })),
  })
}

/** The body upstream's `SendMessageBodySchema` accepts, or undefined. */
function sendBody(body: unknown): { body?: string; message_kind: 'chat' | 'sticker'; sticker_id?: number } | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const raw = body as Record<string, unknown>
  if (raw.body !== undefined && typeof raw.body !== 'string') return undefined
  const kind = raw.message_kind === undefined ? 'chat' : raw.message_kind
  if (kind !== 'chat' && kind !== 'sticker') return undefined
  let stickerId: number | undefined
  if (raw.sticker_id !== undefined) {
    // z.coerce.number().int().positive()
    stickerId = Number(raw.sticker_id)
    if (!Number.isInteger(stickerId) || stickerId <= 0) return undefined
    stickerId = rowId(stickerId)
  }
  return {
    ...(raw.body === undefined ? {} : { body: raw.body as string }),
    message_kind: kind,
    ...(stickerId === undefined ? {} : { sticker_id: stickerId }),
  }
}

async function sendMessage(ctx: Ctx<C>, id: number): Promise<Reply> {
  if ((await ctx.db.channel.findUnique({ select: { id: true }, where: { id } })) === null) {
    return json(404, { error: 'not_found' })
  }
  const parsed = sendBody(jsonBody(ctx.body))
  if (parsed === undefined) return json(400, { error: 'invalid_body' })
  const { message_kind, sticker_id } = parsed
  let body = parsed.body ?? ''
  let sourceRef: string | null = null
  if (message_kind === 'chat') {
    if (body.trim().length === 0) return json(400, { error: 'missing_body' })
  } else {
    if (sticker_id === undefined) return json(400, { error: 'missing_sticker_id' })
    const sticker = await ctx.db.userSticker.findUnique({ where: { id: sticker_id } })
    if (sticker === null) return json(400, { error: 'sticker_not_found' })
    if (sticker.user_id !== USER_ID) return json(403, { error: 'sticker_not_owned' })
    sourceRef = String(sticker.id)
    if (sticker.pack_id !== null) {
      // The sticker's place in its pack names its preview's label.
      const index = await ctx.db.userSticker.count({ where: { pack_id: sticker.pack_id, id: { lt: sticker.id } } })
      const pack = await ctx.db.stickerPack.findUnique({ select: { previews_json: true }, where: { id: sticker.pack_id } })
      const label = pack === null ? undefined : previews(pack.previews_json)[index]?.label
      body = `[sticker: ${label ?? 'sticker'}]`
    } else {
      body = '[sticker: custom]'
    }
  }
  const row = await ctx.db.message.create({
    data: { channel_id: id, sender: 'You', body, sent_at: ctx.clock.nowIso(), message_kind, source_ref: sourceRef },
  })
  return json(201, { id: row.id })
}

// --- static files ---

/** A sticker's file, from the run's `_sticker_file`. */
async function stickerFile(ctx: Ctx<C>): Promise<Reply | null> {
  const name = ctx.params.name ?? ''
  const row = await ctx.db.stickerFile.findUnique({ where: { storage_path: `${STICKER_PREFIX}${name}` } })
  if (row === null) return null
  return { status: 200, body: Buffer.from(row.data, 'base64'), headers: { 'Content-Type': mimeOf(name) } }
}

/** A store preview, from upstream's art. */
function storeFile(ctx: Ctx<C>): Reply | null {
  const name = ctx.params.name ?? ''
  if (name !== basename(name) || name.startsWith('.')) return null
  try {
    return { status: 200, body: readFileSync(join(STORE_ASSETS, name)), headers: { 'Content-Type': mimeOf(name) } }
  } catch {
    return null
  }
}

export function apiRoutes(): KitRoute<C>[] {
  return [
    route<C>('GET', '/__mock_sentinel__/chat', () => json(200, { ok: true })),
    route<C>('GET', '/health', () => json(200, { status: 'healthy', service: 'chat-mock' })),
    route<C>('GET', '/api/stickers', listStickers),
    route<C>('POST', '/api/stickers', uploadSticker, { write: true }),
    route<C>('GET', '/api/stickers/:id', withId('id', getSticker)),
    route<C>('PATCH', '/api/stickers/:id', withId('id', patchSticker), { write: true }),
    route<C>('DELETE', '/api/stickers/:id', withId('id', deleteSticker), { write: true }),
    route<C>('GET', '/api/store/packs', listPacks),
    route<C>('POST', '/api/store/packs/:id/acquire', withId('id', acquirePack), { write: true }),
    route<C>('GET', '/api/channels', listChannels),
    route<C>('GET', '/api/channels/:id/messages', withId('id', listMessages)),
    route<C>('POST', '/api/channels/:id/messages', withId('id', sendMessage), { write: true }),
  ]
}

/** The static routes, which fall through to Hono's 404 for a missing file. */
export function staticRoutes(notFound: () => Reply): KitRoute<C>[] {
  return [
    route<C>('GET', '/static/chat/stickers/:name', async (ctx) => (await stickerFile(ctx)) ?? notFound()),
    route<C>('GET', '/static/chat/store/:name', (ctx) => storeFile(ctx) ?? notFound()),
  ]
}
