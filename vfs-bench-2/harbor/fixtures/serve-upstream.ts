/**
 * Serve upstream's mock for one task as its image starts it, for
 * compare-upstream.ts to set beside the kit fake that runs it.
 *
 *     TZ=UTC bun harbor/fixtures/serve-upstream.ts <service> <task> <epoch>
 *
 * The mock is booted as upstream.ts boots it for the fixture (its factory
 * and `seed()` under Bun, at the frozen epoch, each of its image's paths
 * under a scratch root), its task's startup rows and files added, and its
 * app served on a free port of the loopback. Once it listens this prints
 * `UPSTREAM={"url": ..., "root": ...}`, `root` standing for the image's `/`;
 * it stops when its stdin closes.
 */
import { resolve } from 'node:path'

import { UPSTREAM_ERROR_HEADER } from '../upstream-errors.ts'
import { boot, startup } from './upstream.ts'

/** LiveClawBench's mock platform, as main.ts finds it. */
const PLATFORM = resolve(import.meta.dir, '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform')

const [service, task, epoch] = process.argv.slice(2)
if (service === undefined || task === undefined || epoch === undefined) {
  throw new Error('usage: serve-upstream.ts <service> <task> <epoch>')
}
const booted = await boot(PLATFORM, service, task, epoch)
await startup(PLATFORM, service, task, booted)
// Upstream masks internal errors in its response body. An outer Hono
// middleware can inspect the caught error without replacing its handler,
// status or body. Use upstream's own Hono so route() keeps that handler.
const { Hono } = await import(resolve(PLATFORM, 'node_modules/hono/dist/index.js'))
const app = new Hono()
app.use('*', async (c: { error?: Error; header: (name: string, value: string) => void }, next: () => Promise<void>) => {
  await next()
  if (c.error) c.header(UPSTREAM_ERROR_HEADER, c.error.message)
})
app.route('/', booted.app)
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => app.fetch(request) })
console.log(`UPSTREAM=${JSON.stringify({ url: `http://127.0.0.1:${server.port}`, root: booted.root })}`)
for await (const _ of Bun.stdin.stream()) {
  // Until the parent closes stdin.
}
server.stop(true)
