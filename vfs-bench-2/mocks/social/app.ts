/**
 * The social fake's routes: upstream's own app (mocks/social/src/index.tsx),
 * its handlers, pages and mock-lib's app factory, auth middleware and error
 * handler, answering each request on the run it was sent to.
 *
 * Upstream's mock is one Hono app over one bun:sqlite database. It is
 * bundled once with esbuild, Hono and its JSX runtime from upstream's own
 * node_modules, with what it reads from its process taken from the request
 * instead:
 *
 * - its database (`./db`'s `getDb()`): the run's file, opened for the
 *   request (sqlite.ts); `publishDueScheduledPosts` is upstream's;
 * - mock-lib's JWT (`sign`, `verify`, `tokenCookieOptions`) and
 *   `shouldInject`: the run's secret and faults (session.ts); the
 *   middleware that calls them is mock-lib's;
 * - `new Date()`, `Date.now()` and `process.env.TASK_NAME`: the request's
 *   time and the run's task (globals.ts).
 *
 * Every request is a write to the kit, so a run's requests take turns, as
 * a single-threaded mock's do. One that changes a row moves the run's clock
 * a tick.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { TICK_MS, route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { INTEG, MOCK_LIB as MOCK_LIB_PATH, UPSTREAM as UPSTREAM_PATH } from './config.ts'
import type { C } from './config.ts'
import { of } from './session.ts'
import { open, within } from './sqlite.ts'

// Real paths, as esbuild names importers: `state/` is a link.
const HERE = realpathSync(dirname(fileURLToPath(import.meta.url)))
const UPSTREAM = realpathSync(UPSTREAM_PATH)
const MOCK_LIB = realpathSync(MOCK_LIB_PATH)

/** This fake's modules the bundle imports rather than copies, so it and the fake share them. */
const SHARED = new Set(['sqlite.ts', 'session.ts'].map((name) => join(HERE, name)))

/** Modules the bundle gets in place of upstream's, by name. */
const VIRTUAL: Record<string, string> = {
  'mock-lib': [
    `export { createMockApp } from ${JSON.stringify(join(MOCK_LIB, 'src', 'create-app.ts'))}`,
    `export { authRequired, authOptional } from ${JSON.stringify(join(MOCK_LIB, 'src', 'auth', 'middleware.ts'))}`,
    `export { sign, verify, tokenCookieOptions, shouldInject, startServer } from ${JSON.stringify(join(HERE, 'session.ts'))}`,
  ].join('\n'),
  db: [
    `export { publishDueScheduledPosts } from ${JSON.stringify(join(UPSTREAM, 'src', 'db.ts'))}`,
    `export { getDb } from ${JSON.stringify(join(HERE, 'sqlite.ts'))}`,
  ].join('\n'),
  // Imported by upstream's db.ts, for the `getDb()` the fake replaces.
  'bun:sqlite': `export class Database { constructor() { throw new Error('bun:sqlite is not here') } }`,
  // Imported by mock-lib's app factory, for a frontend the mock has none of.
  'hono/bun': `export function serveStatic() { throw new Error('hono/bun is not here') }`,
}

interface OnResolveArgs {
  path: string
  importer: string
}

/** The one esbuild call this makes. */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>
}

interface SocialApp {
  app: { fetch: (request: Request) => Response | Promise<Response> }
}

let bundled: Promise<SocialApp> | undefined

/** Upstream's app, bundled and built once. */
function socialApp(): Promise<SocialApp> {
  bundled ??= (async () => {
    // esbuild is tsx's, which runs every kit fake.
    const require = createRequire(createRequire(join(INTEG, 'package.json')).resolve('tsx/package.json'))
    const esbuild = require('esbuild') as Esbuild
    const source = join(UPSTREAM, 'src')
    const redirect = {
      name: 'vfsbench-social',
      setup(build: {
        onResolve(o: { filter: RegExp }, f: (a: OnResolveArgs) => Record<string, unknown> | undefined): void
        onLoad(o: { filter: RegExp; namespace: string }, f: (a: { path: string }) => Record<string, unknown>): void
      }) {
        build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          const at = (name: string) => join(dirname(importer), name)
          if (path === 'mock-lib' || path === 'bun:sqlite' || path === 'hono/bun') return { path, namespace: 'vfsbench' }
          if (path === './db' && importer === join(source, 'index.tsx')) return { path: 'db', namespace: 'vfsbench' }
          if (path === './jwt' && importer === join(MOCK_LIB, 'src', 'auth', 'middleware.ts')) {
            return { path: pathToFileURL(join(HERE, 'session.ts')).href, external: true }
          }
          const file = path.startsWith('.') ? at(path) : path
          if (SHARED.has(file)) return { path: pathToFileURL(file).href, external: true }
          return undefined
        })
        build.onLoad({ filter: /.*/, namespace: 'vfsbench' }, ({ path }) => ({ contents: VIRTUAL[path], loader: 'ts', resolveDir: source }))
      },
    }
    const out = await esbuild.build({
      stdin: { contents: `export { createSocialApp } from ${JSON.stringify(join(source, 'index.tsx'))}`, resolveDir: source, loader: 'ts' },
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      jsxImportSource: 'hono/jsx',
      inject: [join(HERE, 'globals.ts')],
      define: { 'process.env.TASK_NAME': '__vfsbenchEnv.TASK_NAME', 'import.meta.main': 'false' },
      plugins: [redirect],
      write: false,
      logLevel: 'silent',
    })
    const dir = mkdtempSync(join(tmpdir(), 'vfsbench-social-app-'))
    try {
      const file = join(dir, 'app.mjs')
      writeFileSync(file, out.outputFiles[0]!.text)
      const { createSocialApp } = (await import(pathToFileURL(file).href)) as { createSocialApp: () => SocialApp }
      return createSocialApp()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()
  return bundled
}

/** Headers of the connection, not the request. */
const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'])

/** The request upstream's app is handed: its path on the mock's own port. */
function requestOf(method: string, ctx: Ctx<C>): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(ctx.headers)) {
    if (value === undefined || HOP.has(name.toLowerCase())) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(`http://localhost:5008${ctx.url.pathname}${ctx.url.search}`, {
    method,
    headers,
    ...(hasBody ? { body: new Uint8Array(ctx.body) } : {}),
  })
}

/** A header's name as the kit writes it (`Content-Type`). */
const headerName = (name: string) => name.replace(/(^|-)([a-z])/g, (_m, dash: string, c: string) => dash + c.toUpperCase())

async function replyOf(response: Response): Promise<Reply> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[headerName(name)] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  const body = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers, ...(body.length > 0 ? { body } : {}) }
}

/** One request, answered by upstream's app on the run's file at the run's time. */
async function answer(method: string, ctx: Ctx<C>): Promise<Reply> {
  const { app } = await socialApp()
  const nowMs = Date.parse(ctx.clock.lastIso()) + TICK_MS
  const db = await open(ctx.db.file, nowMs)
  try {
    const env = db.query("SELECT value FROM _env WHERE name = 'TASK_NAME'").get() as { value: string } | null
    const reply = await within({ db, nowMs, taskName: env?.value ?? '', run: of(ctx.db) }, async () =>
      replyOf(await app.fetch(requestOf(method, ctx))),
    )
    if (db.changed()) ctx.clock.nowMs()
    return reply
  } finally {
    db.close()
  }
}

/** Every path, for each method a client may send. */
export function socialRoutes(): KitRoute<C>[] {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) =>
    route<C>(method, '/*rest', (ctx) => answer(method, ctx), { write: true }),
  )
}
