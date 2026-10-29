/**
 * Loaded into each trial's Mirage daemon before it starts: the trial's
 * network, and the daemon's lifetime.
 *
 *     VFSBENCH_ROUTES='{"5003":"http://127.0.0.1:53211/_run/t1"}' \
 *     VFSBENCH_ALLOW='["http://127.0.0.1:53300/_run/t1"]' \
 *       node --import ./harbor/preload.ts <daemon>
 *
 * Mirage's curl fetches through the global `fetch`, and through the fetch
 * `registerInsecureFetch` holds for -k, as do the mounts and CLIs that
 * call a service (`/gmail`, `gws`). Both are replaced here. A request to an
 * upstream port on localhost goes to that port's mock, under the route's
 * path: a fake the job shares is reached at this trial's run of it
 * (`/_run/<run>/<path>`). A request under one of this trial's runs (an
 * `ALLOW` base) goes as it is, which is how a mount reaches its service.
 * Every other request fails as an unreachable host does, including one to
 * a mock's real port, this trial's or another's, and to a shared fake
 * outside this trial's runs. Under a run, the kit's own endpoints
 * (`/reset`, `/_kit/...`) answer 404, as the service would.
 *
 * A daemon serves one trial, so this is that trial's network. Mirage has
 * no per-workspace hook for this, so a daemon shared by trials could not
 * give each its own.
 *
 * The daemon's clock is the run's (clock.ts), and a task's tools become
 * CLIs here too (tools.ts), when it names some.
 *
 * The daemon stops, as on SIGTERM, when its stdin closes: the environment
 * that started it is gone.
 */
import './clock.ts'

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

/** A base URL's origin and path, the path without a trailing slash. */
const base = (url: string) => {
  const parsed = new URL(url)
  return { origin: parsed.origin, path: parsed.pathname.replace(/\/$/, '') }
}

const routes = new Map(
  Object.entries(JSON.parse(process.env.VFSBENCH_ROUTES ?? '{}') as Record<string, string>).map(([port, url]) => [
    Number(port),
    base(url),
  ]),
)
const allowed = (JSON.parse(process.env.VFSBENCH_ALLOW ?? '[]') as string[]).map(base)
const send = globalThis.fetch

/** The kit's own endpoints, which no upstream service has. */
const KIT = /^\/(reset|_kit)(\/|$)/

/**
 * Where a request for `url` goes, as a URL and the path under its run, or
 * null for a host the trial cannot reach.
 */
function target(url: URL): { to: string; under: string } | null {
  if (url.protocol !== 'http:') return null
  const route = LOCAL.has(url.hostname) ? routes.get(Number(url.port)) : undefined
  if (route !== undefined) {
    // A trial's own mock has no path; a shared fake's run does.
    return { to: `${route.origin}${route.path}${url.pathname}${url.search}`, under: route.path === '' ? '' : url.pathname }
  }
  for (const run of allowed) {
    const inside = url.pathname === run.path || url.pathname.startsWith(`${run.path}/`)
    if (run.path !== '' && url.origin === run.origin && inside) {
      return { to: url.href, under: url.pathname.slice(run.path.length) || '/' }
    }
  }
  return null
}

const routed = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const hop = target(url)
  if (hop === null) {
    return Promise.reject(new TypeError('fetch failed', { cause: new Error(`connect ECONNREFUSED ${url.host}`) }))
  }
  if (KIT.test(hop.under)) {
    return Promise.resolve(new Response('404 Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } }))
  }
  return send(input instanceof Request ? new Request(hop.to, input) : hop.to, init)
}) as typeof fetch

globalThis.fetch = routed
registerInsecureFetch(routed)

if (process.env.VFSBENCH_TOOLS !== undefined) await import('./tools.ts')

process.stdin.on('close', () => process.kill(process.pid, 'SIGTERM'))
process.stdin.resume()
