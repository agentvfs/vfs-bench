/**
 * One Agent-Diff backend for one run, as a fake for harness/fakes.ts.
 *
 *     node agentdiff/backend.ts --project <name> --seed box
 *
 * Starts `compose.yaml` as its own compose project (Postgres on tmpfs, the
 * API on an ephemeral loopback port, only the task's service seeded),
 * prints `AGENTDIFF_URL=` once the API answers, and on SIGTERM takes the
 * project down with its volumes, so no two runs share a database.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { STATE } from '../harness/paths.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { project: { type: 'string' }, seed: { type: 'string' } } })

const env = {
  ...process.env,
  AGENTDIFF_BACKEND: join(STATE, 'agentdiff', 'src', 'backend'),
  AGENTDIFF_HERE: HERE,
  AGENTDIFF_SEED: values.seed!,
}
/**
 * Run `docker compose` on this run's project and return its stdout; its
 * stderr, and with `toLog` its stdout too, goes to stderr, the fake's log.
 */
const compose = (args: string[], toLog = false) =>
  execFileSync('docker', ['compose', '-p', values.project!, '-f', join(HERE, 'compose.yaml'), ...args], {
    env,
    stdio: ['ignore', toLog ? process.stderr.fd : 'pipe', 'inherit'],
    encoding: 'utf8',
  })

let stopping = false
function down(code: number): never {
  if (!stopping) {
    stopping = true
    // The backend's log first, but the project comes down even without it.
    for (const args of [['logs', '--no-color', 'backend'], ['down', '--volumes', '--remove-orphans', '--timeout', '2']]) {
      try {
        compose(args, true)
      } catch (error) {
        process.stderr.write(`compose ${args[0]} failed: ${(error as Error).message}\n`)
      }
    }
  }
  process.exit(code)
}
process.on('SIGTERM', () => down(0))
process.on('SIGINT', () => down(0))

try {
  compose(['up', '--detach', '--wait'])
} catch {
  down(1)
}
const address = compose(['port', 'backend', '8000']).trim()
console.log(`AGENTDIFF_URL=http://${address}`)
setInterval(() => {}, 1 << 30)
