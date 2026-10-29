/**
 * Start one kit fake that every trial of a Harbor job shares, for
 * vfsbench_harbor's MirageEnvironment.
 *
 *     node harbor/fakes.ts --service chat --root <dir> --fixture <name>
 *
 * A service is this repo's fake under `mocks/<service>/` (chat, weather)
 * or, failing that, Mirage's own integ fake (gws). It starts with
 * harness/fakes.ts on a free port, seeding from `<root>/fixtures/<service>/`,
 * and its run `default` from `--fixture`; no trial uses that run. Each trial
 * is a run of its own (`POST /reset {"run": ...}`), its SQLite file under
 * the fake's state directory. Once the fake listens this prints
 * `FAKE={"url": ..., "state": ...}`, and it stops the fake on SIGTERM or
 * when its stdin closes (its parent is gone).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { type Fake, kit, start } from '../harness/fakes.ts'
import { INTEG, ROOT } from '../harness/paths.ts'
import { Run } from '../harness/runs.ts'

/** This repo's kit fakes, one directory each. */
export const MOCKS = join(ROOT, 'mocks')

/**
 * Generate a fake's Prisma client if it is missing or older than its
 * schema. It is generated beside, then moved into place, so a second
 * launcher never loads a half-written one.
 *
 * Prisma resolves @prisma/client from the client's directory, so
 * `mocks/node_modules` links Mirage's integ packages (it is gitignored), and
 * it is told never to install a missing one: that would edit package.json.
 */
function ensureClient(service: string): void {
  const dir = join(MOCKS, service)
  const out = join(dir, 'generated')
  const index = join(out, 'index.js')
  const schema = join(dir, `${service}.prisma`)
  if (existsSync(index) && statSync(index).mtimeMs >= statSync(schema).mtimeMs) return
  const modules = join(MOCKS, 'node_modules')
  try {
    symlinkSync(relative(MOCKS, join(INTEG, 'node_modules')), modules)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const staged = join(dir, `generated.${process.pid}`)
  const source = join(dir, `generated.${process.pid}.schema`)
  try {
    mkdirSync(source, { recursive: true })
    const text = readFileSync(schema, 'utf8').replace(/output\s*=\s*"generated"/, `output = ${JSON.stringify(staged)}`)
    writeFileSync(join(source, 'schema.prisma'), text)
    execFileSync(process.execPath, [join(INTEG, 'node_modules', 'prisma', 'build', 'index.js'), 'generate', '--schema', join(source, 'schema.prisma')], {
      cwd: dir,
      env: {
        ...process.env,
        INTEG_DB_URL: `file:${join(source, 'generate.db')}`,
        PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
        PRISMA_HIDE_UPDATE_MESSAGE: 'true',
      },
      stdio: 'pipe',
      timeout: 120_000,
    })
    rmSync(out, { recursive: true, force: true })
    renameSync(staged, out)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(staged, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  // Every run is in UTC, as harness/execute.ts runs it; the fake inherits it.
  process.env.TZ = 'UTC'
  const { values } = parseArgs({ options: { service: { type: 'string' }, root: { type: 'string' }, fixture: { type: 'string' } } })
  const { service, fixture } = values
  if (service === undefined || values.root === undefined || fixture === undefined) {
    throw new Error('usage: fakes.ts --service <name> --root <dir> --fixture <name>')
  }
  const root = resolve(values.root)
  mkdirSync(join(root, 'fixtures', service), { recursive: true })
  const ours = existsSync(join(MOCKS, service, 'main.ts'))
  if (ours) ensureClient(service)
  const run = new Run(`fakes-${service}`, root)
  const spec = kit(run, service, fixture, ours ? join(MOCKS, service, 'main.ts') : undefined)

  let fake: Fake | undefined
  let stopping: Promise<void> | undefined
  const stop = () =>
    (stopping ??= (async () => {
      try {
        await run.stop()
      } finally {
        if (fake !== undefined) writeFileSync(join(root, `${service}.log`), fake.log.join('\n'))
      }
    })())
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void stop().finally(() => process.exit(0)))
  process.stdin.on('close', () => void stop().finally(() => process.exit(0)))
  process.stdin.resume()
  try {
    fake = await start(spec, run)
  } catch (error) {
    await stop()
    throw error
  }
  console.log(`FAKE=${JSON.stringify({ url: fake.url, state: fake.stateDir })}`)
}

main().catch((error: unknown) => {
  console.error((error as Error).stack ?? String(error))
  process.exit(1)
})
