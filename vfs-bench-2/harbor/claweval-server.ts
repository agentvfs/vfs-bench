/** Private grading endpoint on the same HTTP server as the trial workspace. */
import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from '../submodule/mirage/typescript/packages/server/node_modules/fastify/fastify.js'
import { judgeTransport, verifyClaw, type ClawRequest } from './verify-claweval.ts'

type App = Pick<FastifyInstance, 'post' | 'addHook'>
export function registerClawVerifier(app: App, options: { token: string; task: string; fetch: typeof fetch }) {
  if (!options.token || !options.task) throw new Error('Verifier requires a private capability and task')
  const authorization = Buffer.from(`Bearer ${options.token}`)
  const active = new Set<AbortController>()
  app.addHook('preClose', async () => {
    for (const controller of active) controller.abort()
  })
  app.post<{ Body: ClawRequest & { runtime: string } }>('/v1/harbor/claweval/verify', {
    bodyLimit: 96 * 1024 * 1024,
    onRequest: async (request, reply) => {
      const supplied = Buffer.from(request.headers.authorization ?? '')
      if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization))
        return reply.code(403).send({ detail: 'Private verifier capability required' })
    },
    schema: { body: {
      type: 'object', required: ['task', 'runtime', 'files', 'timeoutSeconds'],
      properties: {
        task: { type: 'string' }, runtime: { const: 'claweval-pyodide' },
        files: { type: 'object', additionalProperties: { type: 'string' } },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        timeoutSeconds: { type: 'number', exclusiveMinimum: 0 },
      },
    } },
  }, async (request, reply) => {
    if (request.body.task !== options.task)
      return reply.code(400).send({ detail: 'Verifier task does not match this trial' })
    const controller = new AbortController()
    active.add(controller)
    const abort = () => { if (!reply.raw.writableFinished) controller.abort() }
    request.raw.on('aborted', abort)
    reply.raw.on('close', abort)
    try {
      const result = await verifyClaw(request.body,
        judgeTransport(request.body.env ?? {}, options.fetch), controller.signal)
      return { ...result, timings: { ...result.timings, server_pid: process.pid, execution: 'trial-daemon' } }
    } catch (error) {
      return reply.code(controller.signal.aborted ? 408 : 500).send({ detail: (error as Error).message })
    } finally {
      active.delete(controller)
      request.raw.off('aborted', abort)
      reply.raw.off('close', abort)
    }
  })
}
