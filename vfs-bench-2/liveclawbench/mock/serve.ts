/**
 * Serve one LiveClawBench mock on a free port, for harness/fakes.ts.
 *
 *     bun liveclawbench/mock/serve.ts --mocks <mock-platform>/mocks --mock finance --name FINANCE
 *
 * Builds the mock with its own factory, `create<Name>App`, as upstream's
 * `generate-openapi.ts` finds it, seeds it as upstream's `startServer`
 * does, and serves it with Bun on a free port, printing `<NAME>_URL=` once
 * listening. `GET /__vfsbench__/openapi.json` returns the mock's OpenAPI
 * document, as upstream generates it. The mock reads its database paths
 * and `TASK_NAME` from the environment, as in upstream's task images.
 *
 * Run by Bun, not Node: the mocks use `bun:sqlite` and `Bun.serve`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: { mocks: { type: 'string' }, mock: { type: 'string' }, name: { type: 'string' } },
})
const mock = values.mock!
const dir = join(values.mocks!, mock, 'src')
const entry = existsSync(join(dir, 'index.tsx')) ? join(dir, 'index.tsx') : join(dir, 'index.ts')
const factory = `create${mock.split('-').map((s) => s[0]!.toUpperCase() + s.slice(1)).join('')}App`

const module = await import(entry)
const app = module[factory]()
if (app.seed) await app.seed()
const spec = app.app.getOpenAPI31Document(app.openApiInfo ? { openapi: '3.1.0', info: app.openApiInfo } : undefined)

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (request: Request) =>
    new URL(request.url).pathname === '/__vfsbench__/openapi.json' ? Response.json(spec) : app.app.fetch(request),
})
console.log(`${values.name}_URL=http://127.0.0.1:${server.port}`)
