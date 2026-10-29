/**
 * Start one Harbor trial's mocks and lay out its workspace, for
 * vfsbench_harbor's MirageEnvironment.
 *
 *     node harbor/mocks.ts --task <task dir> --run <run dir>
 *
 * An adapter (`liveclawbench.ts`) reads the task directory into a `Plan`.
 * This starts the plan's fakes with harness/fakes.ts, each on a free port,
 * fills the run's directories, and writes `<run>/plan.json`: the Mirage
 * workspace config to create, each mount's host directory, the mocks'
 * state files, the routes from upstream's ports to the mocks and the
 * Dockerfile's `RUN` lines. It prints `PLAN=<path>` once the mocks are
 * listening, as a fake prints its URL, and stops them on SIGTERM or when
 * its stdin closes (its parent is gone).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { parse, stringify } from 'yaml'

import { type FakeSpec, start } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { Run } from '../harness/runs.ts'
import * as liveclawbench from './liveclawbench.ts'

/** What a task's environment needs, as an adapter reads it from the task. */
export interface Plan {
  /** The upstream task, which names the run. */
  name: string
  fakes: FakeSpec[]
  /** Each port the task reaches a fake at on localhost, and the fake's name. */
  routes: Record<number, string>
  /** Each file a fake keeps its state in, by the workspace path the task reads it at. */
  state: Record<string, string>
  /** The environment every command sees, as the container's. */
  env: Record<string, string>
  /** Host directories copied into the workspace, by workspace path. */
  copies: Record<string, string>
  /**
   * The Dockerfile's `RUN` lines, each with the directory it runs in, which
   * run in the workspace once it opens, as a build's would.
   */
  run: { cwd: string; line: string }[]
  /** Where a command runs when Harbor names no directory. */
  workdir?: string
}

interface MountBlock {
  vfs: string
  mode: string
  read: string
  config: { root: string }
}

const HERE = dirname(fileURLToPath(import.meta.url))

/** Each `${NAME}` in the config's strings, from `vars`. */
function interpolate<T>(value: T, vars: Record<string, string>): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === 'string'
        ? v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => {
            if (vars[name] === undefined) throw new Error(`workspace.yaml names \${${name}}, which is unset`)
            return vars[name]!
          })
        : v,
    ),
  ) as T
}

/** A workspace path's host file, through the mount it is in. */
function hostPath(mounts: Record<string, MountBlock>, path: string): string | undefined {
  const prefix = Object.keys(mounts)
    .filter((m) => path === m || path.startsWith(`${m}/`))
    .sort((a, b) => b.length - a.length)[0]
  return prefix === undefined ? undefined : join(mounts[prefix]!.config.root, relative(prefix, path))
}

async function main(): Promise<void> {
  // Every run is in UTC, as harness/execute.ts runs it; the fakes inherit it.
  process.env.TZ = 'UTC'
  const { values } = parseArgs({ options: { task: { type: 'string' }, run: { type: 'string' } } })
  if (values.task === undefined || values.run === undefined) throw new Error('usage: mocks.ts --task <dir> --run <dir>')
  const runDir = resolve(values.run)
  mkdirSync(runDir, { recursive: true })
  const run = new Run(basename(runDir), runDir)
  const plan = liveclawbench.plan(resolve(values.task), run)

  // Stop the fakes and keep their logs, once, however the run ends.
  let stopping: Promise<void> | undefined
  const stop = () =>
    (stopping ??= (async () => {
      try {
        await run.stop()
      } finally {
        for (const fake of run.fakes.values()) writeFileSync(join(runDir, `${fake.name}.log`), fake.log.join('\n'))
      }
    })())
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void stop().finally(() => process.exit(0)))
  process.stdin.on('close', () => void stop().finally(() => process.exit(0)))
  process.stdin.resume()
  try {
    await prepare(plan, run)
  } catch (error) {
    await stop()
    throw error
  }
}

/** Lay out the run's directories, start the fakes and write the plan. */
async function prepare(plan: Plan, run: Run): Promise<void> {
  const runDir = run.dir
  const config = interpolate(parse(readFileSync(join(HERE, 'workspace.yaml'), 'utf8')) as Record<string, unknown>, {
    RUN_DIR: runDir,
    PYTHON_PACKAGES: join(STATE, 'python'),
  })
  const mounts = config.mounts as Record<string, MountBlock>
  // A state file outside every mount gets its directory mounted read-only,
  // parents first, so a nested one lands in its parent's mount.
  const state: [string, string][] = []
  for (const [path, live] of Object.entries(plan.state).sort(([a], [b]) => dirname(a).length - dirname(b).length)) {
    if (hostPath(mounts, path) === undefined) {
      mounts[dirname(path)] = { vfs: 'disk', mode: 'read', read: 'fresh', config: { root: join(runDir, 'state', dirname(path)) } }
    }
    state.push([hostPath(mounts, path)!, live])
  }
  for (const mount of Object.values(mounts)) mkdirSync(mount.config.root, { recursive: true })
  for (const [path, from] of Object.entries(plan.copies)) {
    const to = hostPath(mounts, path)
    if (to === undefined) throw new Error(`${plan.name}: COPY to ${path}, which is outside the workspace's mounts`)
    cpSync(from, to, { recursive: true })
  }
  config.env = plan.env
  writeFileSync(join(runDir, 'workspace.yaml'), `# ${plan.name}, generated by harbor/mocks.ts.\n${stringify(config)}`)

  for (const spec of plan.fakes) await start(spec, run)
  const out = join(runDir, 'plan.json')
  writeFileSync(
    out,
    JSON.stringify(
      {
        task: plan.name,
        config,
        mounts: Object.fromEntries(Object.entries(mounts).map(([path, m]) => [path, { root: m.config.root, mode: m.mode }])),
        state,
        routes: Object.fromEntries(Object.entries(plan.routes).map(([port, name]) => [port, run.fakes.get(name)!.url])),
        run: plan.run,
        workdir: plan.workdir ?? '/',
      },
      null,
      1,
    ),
  )
  console.log(`PLAN=${out}`)
}

main().catch((error: unknown) => {
  console.error((error as Error).stack ?? String(error))
  process.exit(1)
})
