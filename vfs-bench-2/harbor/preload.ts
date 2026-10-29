/**
 * Loaded into each trial's Mirage daemon before it starts: the trial's
 * network, and the daemon's lifetime.
 *
 *     VFSBENCH_ROUTES='{"5003":"http://127.0.0.1:53211"}' \
 *       node --import ./harbor/preload.ts <daemon>
 *
 * Mirage's curl fetches through the global `fetch`, and through the fetch
 * `registerInsecureFetch` holds for -k. Both are replaced here: a request
 * to an upstream port on localhost goes to that port's mock, and every
 * other request fails as an unreachable host does, including one to a
 * mock's real port, this trial's or another's. A daemon serves one trial,
 * so this is that trial's network. Mirage has no per-workspace hook for
 * this, so a daemon shared by trials could not give each its own.
 *
 * The daemon stops, as on SIGTERM, when its stdin closes: the environment
 * that started it is gone.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { MIRAGE } from '../harness/paths.ts'

/**
 * A module of the Mirage the daemon runs, by its file, so that this
 * replaces that copy's fetch even where `node_modules` links another.
 */
const mirage = (pkg: string, path: string): Promise<unknown> =>
  import(pathToFileURL(join(MIRAGE, 'typescript', 'packages', pkg, 'dist', `${path}.js`)).href)

const { registerInsecureFetch } = (await mirage(
  'core',
  'commands/builtin/utils/http',
)) as typeof import('@struktoai/mirage-core/commands/builtin/utils/http')
// Registers Node's fetch for -k when loaded, so it loads first and the
// registration below replaces it.
await mirage('node', 'commands/builtin/utils/http')

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

const routes = new Map(
  Object.entries(JSON.parse(process.env.VFSBENCH_ROUTES ?? '{}') as Record<string, string>).map(([port, url]) => [
    Number(port),
    new URL(url),
  ]),
)
const send = globalThis.fetch

/** Where a request for `url` goes, or null for a host the trial cannot reach. */
function target(url: URL): string | null {
  const to = url.protocol === 'http:' && LOCAL.has(url.hostname) ? routes.get(Number(url.port)) : undefined
  return to === undefined ? null : `${to.origin}${url.pathname}${url.search}`
}

const routed = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const to = target(url)
  if (to === null) {
    return Promise.reject(new TypeError('fetch failed', { cause: new Error(`connect ECONNREFUSED ${url.host}`) }))
  }
  return send(input instanceof Request ? new Request(to, input) : to, init)
}) as typeof fetch

globalThis.fetch = routed
registerInsecureFetch(routed)

process.stdin.on('close', () => process.kill(process.pid, 'SIGTERM'))
process.stdin.resume()
