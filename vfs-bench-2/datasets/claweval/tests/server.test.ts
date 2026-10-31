/** Shared HTTP-process grading: access control. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from '../../../submodule/mirage/typescript/packages/server/node_modules/fastify/fastify.js'
import { registerClawVerifier } from '../graders/server.ts'

const task = 'T085_officeqa_army_expenditures'
const headers = { authorization: 'Bearer private-test-capability' }
function server(send: typeof fetch = fetch) {
  const app = Fastify()
  registerClawVerifier(app, { token: 'private-test-capability', task, fetch: send })
  app.get('/health', () => ({ pid: process.pid }))
  return app
}

test('Server verifier requires a private capability and the configured trial task', async () => {
  const app = server()
  try {
    const body = { task: 'wrong-task', runtime: 'claweval-pyodide', files: {}, timeoutSeconds: 5 }
    const denied = await app.inject({ method: 'POST', url: '/v1/harbor/claweval/verify', payload: body })
    assert.equal(denied.statusCode, 403)
    const wrong = await app.inject({ method: 'POST', url: '/v1/harbor/claweval/verify', headers, payload: body })
    assert.equal(wrong.statusCode, 400)
    assert.equal((await app.inject('/health')).statusCode, 200)
  } finally { await app.close() }
})
