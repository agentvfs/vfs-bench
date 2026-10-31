/** The built UI and its API on one port: `node server/main.ts` after `vite build`. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { api, rootDir } from './api.ts'

const DIST = new URL('../dist/', import.meta.url).pathname
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}
const port = Number(process.env.PORT ?? 8787)
const handle = api()

createServer((req, res) => {
  void handle(req, res, async () => {
    const path = normalize(new URL(req.url ?? '/', 'http://ui').pathname).replace(/^(\.\.[/\\])+/, '')
    const file = join(DIST, path === '/' ? 'index.html' : path)
    const data = await readFile(file).catch(() => readFile(join(DIST, 'index.html')))
    res.setHeader('content-type', TYPES[extname(file)] ?? 'text/html; charset=utf-8')
    res.end(data)
  })
}).listen(port, '127.0.0.1', async () => {
  console.log(`VFS-Bench UI on http://127.0.0.1:${port}, driving ${await rootDir()}`)
})
