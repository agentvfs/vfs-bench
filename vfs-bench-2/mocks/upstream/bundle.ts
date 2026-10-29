/**
 * An upstream LiveClawBench mock, bundled with esbuild once and loaded once
 * per run, so that each run has a copy of its own of everything the mock
 * keeps in memory (its database handles, caches, JWT secret, one-shot
 * faults), as each trial's process has upstream.
 *
 * The bundle is the mock's app factory with Hono, zod and mock-lib from
 * upstream's own node_modules, and instance.ts in place of what it reads
 * from its process: `bun:sqlite`, `node:fs`, `hono/bun`'s static files,
 * `Bun`, `Date` and `process.env`.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { DatabaseSync } from 'node:sqlite'

// Real paths, as esbuild names importers: `state/` is a link.
const HERE = realpathSync(dirname(fileURLToPath(import.meta.url)))
const INSTANCE = join(HERE, 'instance.ts')

/** Mirage's integ package, whose tsx (and its esbuild) runs every kit fake. */
const INTEG = join(HERE, '..', '..', 'submodule', 'mirage', 'integ')

/** What fake.ts holds of one run's copy of a mock. */
export interface Copy {
  create: (...args: unknown[]) => { app: { fetch: (request: Request) => Response | Promise<Response> }; seed?: () => unknown }
  vfsbench: {
    configure(options: { env: Record<string, string>; map: Record<string, string>; startMs: number; files: Record<string, Buffer> }): void
    enter(connection: DatabaseSync, nowMs: number): void
    leave(): string[]
  }
}

interface OnResolveArgs {
  path: string
  importer: string
}

/** The one esbuild call this makes. */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>
}

/** Bundle a mock's app factory; the bundle's file. */
export async function bundle(entry: string, factory: string): Promise<string> {
  const require = createRequire(createRequire(join(INTEG, 'package.json')).resolve('tsx/package.json'))
  const esbuild = require('esbuild') as Esbuild
  const source = realpathSync(dirname(entry))
  const virtual: Record<string, string> = {
    'hono/bun': [
      "import { serveStatic as base } from 'hono/serve-static'",
      "import { join } from 'node:path'",
      `import { staticContent } from ${JSON.stringify(INSTANCE)}`,
      'export const serveStatic = (options = {}) => async (c, next) =>',
      '  base({ ...options, getContent: staticContent, join })(c, next)',
    ].join('\n'),
  }
  const plugin = {
    name: 'vfsbench-upstream',
    setup(build: {
      onResolve(o: { filter: RegExp }, f: (a: OnResolveArgs) => Record<string, unknown> | undefined): void
      onLoad(o: { filter: RegExp; namespace: string }, f: (a: { path: string }) => Record<string, unknown>): void
    }) {
      build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
        if (importer === INSTANCE) return undefined
        if (path === 'bun:sqlite' || path === 'node:fs' || path === 'fs') return { path: INSTANCE }
        if (path === 'hono/bun') return { path, namespace: 'vfsbench' }
        return undefined
      })
      build.onLoad({ filter: /.*/, namespace: 'vfsbench' }, ({ path }) => ({ contents: virtual[path], loader: 'js', resolveDir: source }))
    },
  }
  const out = await esbuild.build({
    stdin: {
      contents: [
        `export { ${factory} as create } from ${JSON.stringify(realpathSync(entry))}`,
        `export { vfsbench } from ${JSON.stringify(INSTANCE)}`,
      ].join('\n'),
      resolveDir: source,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    // A dependency that requires a Node module (bcryptjs's crypto) finds it.
    banner: { js: "import { createRequire as __vfsbenchRequire } from 'node:module'; const require = __vfsbenchRequire(import.meta.url);" },
    platform: 'node',
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
    loader: { '.css': 'text', '.html': 'text' },
    inject: [join(HERE, 'globals.ts')],
    define: { 'process.env': '__vfsbenchEnv', 'import.meta.main': 'false' },
    plugins: [plugin],
    write: false,
    logLevel: 'silent',
  })
  const file = join(mkdtempSync(join(tmpdir(), 'vfsbench-upstream-')), 'mock.mjs')
  writeFileSync(file, out.outputFiles[0]!.text)
  return file
}

let copies = 0

/** A copy of its own of a bundled mock: the module loaded afresh. */
export async function load(file: string): Promise<Copy> {
  return (await import(`${pathToFileURL(file).href}?copy=${++copies}`)) as Copy
}
