import { createServer } from 'node:http'
import readline from 'node:readline'

import { verifyGaia2 } from './verify.ts'

let response: string | null = null
const server = process.env.GAIA2_AUDIT_HTTP
  ? createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume the request */ }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: response } }] }))
    })
  : undefined

if (server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
}
try {
  for await (const line of readline.createInterface({ input: process.stdin })) {
    try {
      const request = JSON.parse(line)
      if (server) {
        response = request.auditResponse
        delete request.auditResponse
        const address = server.address() as { port: number }
        request.env = {
          OPENAI_API_KEY: 'mock',
          OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        }
      }
      const result = await verifyGaia2(request)
      console.log(JSON.stringify({ score: result.score }))
    } catch (error) {
      console.log(JSON.stringify({ error: String(error) }))
    }
  }
} finally {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()))
  }
}
