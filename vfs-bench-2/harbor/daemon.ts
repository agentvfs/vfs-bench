/** Harbor's Mirage HTTP server, including its private Claw-Eval verifier. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FastifyInstance } from '../submodule/mirage/typescript/packages/server/node_modules/fastify/fastify.js'
import { hostFetch } from './preload.ts'

async function main() {
  // The pinned server uses transform-types; keep it outside this package's
  // erasable-only TypeScript compilation, as the original launcher did.
  const source = new URL('../submodule/mirage/typescript/packages/server/src/', import.meta.url)
  const { buildApp } = await import(new URL('app.ts', source).href) as {
    buildApp(options: { idleGraceSeconds: number; onIdleExit(): void }): FastifyInstance & { pidFile: string }
  }
  const { readDaemonTable } = await import(new URL('daemon_config.ts', source).href) as {
    readDaemonTable(home: string): { port?: number }
  }
  const { mirageHome } = await import(new URL('paths.ts', source).href) as { mirageHome(): string }
  const config = readDaemonTable(mirageHome())
  const port = Number(process.env.MIRAGE_DAEMON_PORT ?? config.port ?? 8765)
  let exiting = false
  const stop = () => {
    if (exiting) return
    exiting = true
    void app.close().catch((error: unknown) => {
      console.error('daemon close error:', error)
    }).finally(async () => {
      await rm(app.pidFile, { force: true })
      process.exit(0)
    })
  }
  const app = buildApp({
    idleGraceSeconds: Number(process.env.MIRAGE_IDLE_GRACE_SECONDS ?? '30'),
    onIdleExit: stop,
  })
  const token = process.env.VFSBENCH_VERIFIER_TOKEN
  const task = process.env.VFSBENCH_VERIFIER_TASK
  if (token && task) {
    const { registerClawVerifier } = await import('./claweval-server.ts')
    registerClawVerifier(app, { token, task, fetch: hostFetch })
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  await app.listen({ port, host: '127.0.0.1' })
  console.log('HARBOR_SERVER=' + JSON.stringify({ pid: process.pid, port, verifier: task ?? null }))
  await mkdir(dirname(app.pidFile), { recursive: true })
  await writeFile(app.pidFile, String(process.pid))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
