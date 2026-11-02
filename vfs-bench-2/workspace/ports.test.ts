/** `pnpm test`: a run's port reaches that run alone, whatever path it is sent. */
import assert from 'node:assert/strict'
import { Agent, createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'

import { openPort } from './ports.ts'

/** GET `path` on `url` as it is written, dot segments and all. */
function get(url: string, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url)
  return new Promise((resolve, reject) => {
    request({ host: hostname, port, path }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
      .on('error', reject)
      .end()
  })
}

test("a run's port resolves dot segments before it forwards", async () => {
  // The fake: answers with the path as its own URL parsing sees it.
  const fake = createServer((req, res) => res.end(new URL(req.url ?? '/', 'http://fake').pathname))
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const agent = new Agent()
  const port = await openPort(`http://127.0.0.1:${(fake.address() as AddressInfo).port}`, 'a', agent)
  try {
    assert.deepEqual(await get(port.url, '/api/x'), { status: 200, body: '/_run/a/api/x' })
    assert.deepEqual(await get(port.url, '/_run/a/api/x?page=2'), { status: 200, body: '/_run/a/api/x' })
    assert.deepEqual(await get(port.url, '/api/../x'), { status: 200, body: '/_run/a/x' })
    for (const path of [
      '/reset',
      '/../reset',
      '/../../reset',
      '/%2e%2e/reset',
      '/api/../../_kit/health',
      '/../_run/b/api/x',
      '/../../_run/b/api/x',
      '/.%2E/_run/b/api/x',
      '/_run/a/../b/api/x',
      '/_run/a/../../_verifier',
    ]) {
      assert.equal((await get(port.url, path)).status, 404, path)
    }
  } finally {
    port.server.close()
    fake.close()
    agent.destroy()
  }
})
