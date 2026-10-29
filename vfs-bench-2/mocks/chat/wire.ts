/**
 * What upstream's chat mock answers, byte for byte where a caller can see
 * it: its JSON shapes, mock-lib's error envelopes and Hono's defaults.
 */
import type { JsonValue, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'

export const CATEGORIES = ['recent', 'favorite', 'custom'] as const
export type Category = (typeof CATEGORIES)[number]

export interface StickerRow {
  id: number
  user_id: number
  pack_id: number | null
  category: string
  storage_path: string
  mime_type: string
  created_at: string
  sort_order: number | null
}

/** Upstream's `rowToSticker`. */
export function stickerJson(row: StickerRow): JsonValue {
  return {
    id: row.id,
    user_id: row.user_id,
    pack_id: row.pack_id ?? null,
    category: row.category,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    created_at: row.created_at,
    sort_order: row.sort_order,
  }
}

export interface Preview {
  filename: string
  label: string
}

/** A pack's `previews_json`, or none if it does not parse, as upstream reads it. */
export function previews(json: string): Preview[] {
  try {
    return JSON.parse(json) as Preview[]
  } catch {
    return []
  }
}

export function json(status: number, body: JsonValue): Reply {
  return { status, body }
}

/** mock-lib's `err()`: what its validation hook and error handler answer. */
export function failure(status: number, message: string): Reply {
  return { status, body: { success: false, message } }
}

const TEXT = 'text/plain; charset=UTF-8'
const HTML = 'text/html; charset=UTF-8'

/** Hono's own 404, for a path no route answers. */
export function notFound(): Reply {
  return { status: 404, body: Buffer.from('404 Not Found'), headers: { 'Content-Type': TEXT } }
}

export function html(text: string): Reply {
  return { status: 200, body: Buffer.from(text), headers: { 'Content-Type': HTML } }
}

/** Hono's `c.redirect`, a 302. */
export function redirect(location: string): Reply {
  return { status: 302, headers: { Location: location } }
}

/** The largest id Prisma binds to an `Int`. */
const INT_MAX = 2 ** 31 - 1

/**
 * The id to look a row up by. Upstream's SQLite matches an id no row can
 * have (`1.5`, `Infinity`, past 2^31) to nothing, so its handler answers
 * as for a missing row; Prisma refuses to bind one to an `Int`. Such an id
 * is asked for as -1, which no row has.
 */
export function rowId(value: number): number {
  return Number.isInteger(value) && value <= INT_MAX ? value : -1
}

/**
 * A path or query parameter as upstream's zod schema reads it
 * (`z.coerce.number().positive()`), or the 400 its validation hook answers.
 * An id no row can have comes back as `rowId`'s -1.
 */
export function positiveId(name: string, raw: string | undefined): number | Reply {
  const value = Number(raw ?? '')
  if (Number.isNaN(value)) return failure(400, `${name}: Expected number, received nan`)
  if (!(value > 0)) return failure(400, `${name}: Number must be greater than 0`)
  return rowId(value)
}

/** `z.enum(CATEGORIES).optional()` on the query, or its 400. */
export function categoryQuery(raw: string | null): Category | undefined | Reply {
  if (raw === null) return undefined
  if ((CATEGORIES as readonly string[]).includes(raw)) return raw as Category
  return failure(400, `category: Invalid enum value. Expected ${CATEGORIES.map((c) => `'${c}'`).join(' | ')}, received '${raw}'`)
}

export function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'status' in value
}

/** A JSON request body, or undefined where upstream's `c.req.json()` throws. */
export function jsonBody(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    return undefined
  }
}

/** The MIME type Hono's `serveStatic` gives a file, by its extension. */
export function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return (
    {
      svg: 'image/svg+xml',
      png: 'image/png',
      gif: 'image/gif',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      bin: 'application/octet-stream',
    }[ext] ?? 'application/octet-stream'
  )
}
