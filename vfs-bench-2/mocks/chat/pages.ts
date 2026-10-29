/**
 * The chat fake's pages (`/chat`, `/store`, `/stickers`), rendered by
 * upstream's own components (mocks/chat/src/components/*.tsx).
 *
 * The components are Hono JSX and read SQLite synchronously through
 * bun:sqlite's `db.query(sql).all()`. They are bundled once with esbuild,
 * Hono's JSX runtime from upstream's own node_modules, and handed the run's
 * file through node:sqlite, read-only, with the same two calls.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Ctx, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { INTEG, UPSTREAM } from './config.ts'
import type { C } from './config.ts'
import { html, redirect } from './wire.ts'

type Component = (props: Record<string, unknown>) => { toString(): string | Promise<string> }

interface Components {
  ChatRoomPage: Component
  StorePage: Component
  StickerManagerPage: Component
}

/** The one esbuild call this makes. */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>
}

let bundled: Promise<Components> | undefined

/** Upstream's three page components, bundled into one module. */
function components(): Promise<Components> {
  bundled ??= (async () => {
    // esbuild is tsx's, which runs every kit fake.
    const require = createRequire(createRequire(join(INTEG, 'package.json')).resolve('tsx/package.json'))
    const esbuild = require('esbuild') as Esbuild
    const source = join(UPSTREAM, 'src', 'components')
    const entry = [
      `export { ChatRoomPage } from ${JSON.stringify(join(source, 'chat-page.tsx'))}`,
      `export { StorePage } from ${JSON.stringify(join(source, 'store-page.tsx'))}`,
      `export { StickerManagerPage } from ${JSON.stringify(join(source, 'sticker-manager-page.tsx'))}`,
    ].join('\n')
    const out = await esbuild.build({
      stdin: { contents: entry, resolveDir: source, loader: 'ts' },
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      jsxImportSource: 'hono/jsx',
      external: ['bun:sqlite'],
      write: false,
      logLevel: 'silent',
    })
    const dir = mkdtempSync(join(tmpdir(), 'vfsbench-chat-pages-'))
    try {
      const file = join(dir, 'pages.mjs')
      writeFileSync(file, out.outputFiles[0]!.text)
      return (await import(pathToFileURL(file).href)) as Components
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()
  return bundled
}

/** The two bun:sqlite calls the components make, over the run's file. */
async function withDb<T>(file: string, use: (db: unknown) => Promise<T>): Promise<T> {
  // Imported here: node:sqlite warns that it is experimental on import.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return await use({
      query: (sql: string) => {
        const statement = db.prepare(sql)
        return {
          all: (...params: never[]) => statement.all(...params),
          get: (...params: never[]) => statement.get(...params) ?? null,
        }
      },
    })
  } finally {
    db.close()
  }
}

async function page(ctx: Ctx<C>, name: keyof Components, props: Record<string, unknown> = {}): Promise<Reply> {
  const render = (await components())[name]
  return withDb(ctx.db.file, async (db) => html(String(await render({ db, ...props }).toString())))
}

export const pages = {
  root: (): Reply => redirect('/chat'),
  store: (ctx: Ctx<C>) => page(ctx, 'StorePage'),
  stickers: (ctx: Ctx<C>) => page(ctx, 'StickerManagerPage'),
  chat: (ctx: Ctx<C>) => {
    const param = ctx.query.get('channel')
    // Upstream's `parseInt(channelParam, 10)`, NaN included.
    return page(ctx, 'ChatRoomPage', { selectedChannelId: param ? Number.parseInt(param, 10) : undefined })
  },
}
