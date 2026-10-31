/** Judge transport regression checks. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { judgeTransport } from './verify-claweval.ts'

test('Judge transport sends the configured model and keeps credentials out of recordings', async () => {
  let auth = '', body: unknown
  const response = { choices: [{ message: { content: '{"score":0.5,"reasoning":"fixture"}' } }] }
  const server = createServer(async (req, res) => {
    auth = req.headers.authorization ?? ''
    let text = ''
    for await (const chunk of req) text += chunk
    body = JSON.parse(text)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(response))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const request = { model: 'test-model', messages: [{ role: 'user', content: 'rubric' }] }
    const call = judgeTransport({ OPENAI_API_KEY: 'private-test-key', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` })
    const result = await call(request, AbortSignal.timeout(5000))
    assert.deepEqual(result, { response })
    assert.deepEqual(body, request)
    assert.equal(auth, 'Bearer private-test-key')
    assert.equal(JSON.stringify(result).includes('private-test-key'), false)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('Judge transport cancels unsuccessful response bodies before recording HTTP errors', async () => {
  let canceled = 0
  const call = judgeTransport({ OPENAI_API_KEY: 'test' }, async () => new Response(
    new ReadableStream({ cancel() { canceled++ } }), { status: 429 }))
  for (let retry = 0; retry < 3; retry++) {
    assert.deepEqual(await call({ model: 'fixture' }, AbortSignal.timeout(1000)),
      { error: { message: 'Judge HTTP 429', status: 429 } })
    assert.equal(canceled, retry + 1)
  }
})

