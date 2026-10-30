/**
 * Start one kit fake that every trial of a Harbor job shares, for
 * vfsbench_harbor's MirageEnvironment.
 *
 *     node harbor/fakes.ts --service chat --root <dir> --fixture <name> --log <file>
 *
 * A service is this repo's fake under `mocks/<service>/` (chat, weather)
 * or, failing that, Mirage's own integ fake (gws). It starts with
 * harness/fakes.ts on a free port, seeding from `<root>/fixtures/<service>/`,
 * and its run `default` from `--fixture`; no trial uses that run. Each trial
 * is a run of its own (`POST /reset {"run": ...}`), its SQLite file under
 * the fake's state directory. Once the fake listens this prints
 * `FAKE={"url": ..., "state": ...}`, and it stops the fake on SIGTERM or
 * when its stdin closes (its parent is gone), writing the fake's output to
 * `--log`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { type Fake, kit, start } from '../harness/fakes.ts'
import { INTEG, ROOT } from '../harness/paths.ts'
import { Run } from '../harness/runs.ts'

/** This repo's kit fakes, one directory each. */
export const MOCKS = join(ROOT, 'mocks')

/**
 * Generate a fake's Prisma client if its schema has none yet, and point
 * `client` at it.
 *
 * Each schema's client is a directory of its own, `client-<hash>`, and
 * `client` is a link to it, so launchers of jobs started together never
 * delete or overwrite a client another one loads. Each generates beside,
 * then renames into place: the first rename wins and the others drop their
 * copy. The link is swapped by a rename too, which only ever replaces a
 * link. A client an older schema left stays, since a running fake may still
 * be loading it.
 *
 * Prisma resolves @prisma/client from the client's directory, so
 * `mocks/node_modules` links Mirage's integ packages (it is gitignored), and
 * it is told never to install a missing one: that would edit package.json.
 */
function ensureClient(service: string): void {
  const dir = join(MOCKS, service)
  const out = join(dir, 'client')
  const schema = join(dir, `${service}.prisma`)
  const text = readFileSync(schema, 'utf8')
  const name = `client-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`
  const client = join(dir, name)
  if (!existsSync(join(client, 'index.js'))) generate(dir, text, client)
  if (lstatSync(out, { throwIfNoEntry: false })?.isSymbolicLink() && readlinkSync(out) === name) return
  const link = join(dir, `client.${process.pid}.link`)
  rmSync(link, { force: true })
  symlinkSync(name, link)
  renameSync(link, out)
}

/** Generate a schema's Prisma client into `client`, unless another launcher has. */
function generate(dir: string, text: string, client: string): void {
  const modules = join(MOCKS, 'node_modules')
  try {
    symlinkSync(relative(MOCKS, join(INTEG, 'node_modules')), modules)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const staged = join(dir, `client.${process.pid}`)
  const source = join(dir, `client.${process.pid}.schema`)
  try {
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'schema.prisma'), text.replace(/output\s*=\s*"client"/, `output = ${JSON.stringify(staged)}`))
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
    try {
      renameSync(staged, client)
    } catch (error) {
      // Another launcher renamed its copy of the same client first.
      const code = (error as NodeJS.ErrnoException).code
      if ((code !== 'ENOTEMPTY' && code !== 'EEXIST') || !existsSync(join(client, 'index.js'))) throw error
    }
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(staged, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  // Every run is in UTC, as harness/execute.ts runs it; the fake inherits it.
  process.env.TZ = 'UTC'
  const { values } = parseArgs({
    options: { service: { type: 'string' }, root: { type: 'string' }, fixture: { type: 'string' }, log: { type: 'string' } },
  })
  const { service, fixture, log } = values
  if (service === undefined || values.root === undefined || fixture === undefined || log === undefined) {
    throw new Error('usage: fakes.ts --service <name> --root <dir> --fixture <name> --log <file>')
  }
  const root = resolve(values.root)
  mkdirSync(join(root, 'fixtures', service), { recursive: true })
  const ours = existsSync(join(MOCKS, service, 'main.ts'))
  if (ours) ensureClient(service)
  const run = new Run(`fakes-${service}`, root)
  const stateView = Boolean(process.env.VFSBENCH_STATE_TOKEN) && ['airline', 'automationbench', 'chat', 'expense', 'finance', 'gws', 'health', 'insurance', 'mintdiet', 'smarthome', 'social', 'workspace'].includes(service)
  const entry = stateView ? join(ROOT, 'harbor/fake-entry.ts') : ours ? join(MOCKS, service, 'main.ts') : undefined
  const spec = kit(run, service, fixture, entry)
  if (stateView) spec.env = {
    VFSBENCH_FAKE_MODULE: ours ? join(MOCKS, service, 'fake.ts') : join(INTEG, 'server', service, 'fake.ts'),
  }

  let fake: Fake | undefined
  let stopping: Promise<void> | undefined
  const stop = () =>
    (stopping ??= (async () => {
      try {
        await run.stop()
      } finally {
        if (fake !== undefined) writeFileSync(log, fake.log.join('\n'))
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
