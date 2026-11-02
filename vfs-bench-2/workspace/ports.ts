/**
 * A run's own port on a shared fake, for fakes.ts: every request to it goes
 * to that run, as `/_run/<run>/<path>` on the fake. The kit's endpoints
 * (`/reset`, `/_kit/...`), the verifier's state view and another run's path
 * answer 404 there.
 */
import { type Agent, createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** What a run's port never forwards: the kit's, the verifier's and other runs' paths. */
const PRIVATE = /^\/(reset|_kit|_run|_verifier)(\/|\?|$)/

/** Open `run`'s own port on the fake at `url`; its URL. A request whose
 * fake sends nothing for `idle` ms gets a 502. */
export function openPort(
  url: string,
  run: string,
  agent: Agent,
  idle = 120_000,
): Promise<{ url: string; server: Server }> {
  const target = new URL(url)
  const own = `/_run/${run}`
  const server = createServer((req, res) => {
    const raw = req.url ?? '/'
    // Dot segments resolved as the fake's URL parsing resolves them, so
    // `/../_run/<other>` or `/../reset` is checked as what the fake would see.
    const url = new URL(`http://run${raw.startsWith('/') ? raw : `/${raw}`}`)
    let path = url.pathname
    // A URL the fake built for this run (a page's next link) has its prefix.
    if (path === own || path.startsWith(`${own}/`)) path = path.slice(own.length) || '/'
    if (PRIVATE.test(path)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=UTF-8' }).end('404 Not Found')
      return
    }
    const upstream = request(
      { host: target.hostname, port: target.port, method: req.method, path: `${own}${path}${url.search}`, headers: req.headers, agent },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers)
        reply.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    // A client gone before its reply (its command canceled) or a fake that
    // does not answer ends the request, so neither holds a socket open
    // into later trials.
    upstream.setTimeout(idle, () => upstream.destroy(new Error('the fake did not answer')))
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server })
    })
  })
}
