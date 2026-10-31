/**
 * Start one Harbor trial's mocks and lay out its workspace, for
 * vfsbench_harbor's MirageEnvironment.
 *
 *     node harbor/mocks.ts --task <task dir> --run <run dir> [--fakes <json>]
 *
 * `mirage.ts` reads the task's `environment/mirage.yaml` into a `Plan`.
 * This starts the plan's own fakes with harness/fakes.ts, each on a free
 * port, fills the run's directories, and writes `<run>/plan.json`: the Mirage workspace config to
 * create, each mount's host directory, the mocks' state files, the routes
 * from upstream's ports to the mocks and the `RUN` lines. It prints
 * `PLAN=<path>` once the mocks are listening, as a fake prints its URL, and
 * stops them on SIGTERM or when its stdin closes (its parent is gone).
 *
 * A mirage.yaml task's fakes are shared by the job and already running:
 * `--fakes` names each one's run for this trial, its base URL
 * (`<fake>/_run/<run>`) and its SQLite file, and this starts none.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { parse, stringify } from 'yaml'

import { type FakeSpec, start } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { Run } from '../harness/runs.ts'
import { type Copy, copyInto } from './copies.ts'
import * as mirage from './mirage.ts'

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
  /** Host paths copied into the workspace, in mirage.yaml's order (copies.ts). */
  copies: Copy[]
  /**
   * mirage.yaml's `run` lines, each with the directory it runs in, which
   * run in the workspace once it opens, as a build's would.
   */
  run: { cwd: string; line: string }[]
  /** Where a command runs when Harbor names no directory. */
  workdir?: string
  /** Mounts and CLIs the task adds to the workspace config. */
  workspace?: Record<string, unknown>
  /**
   * The task's tools as CLIs (tools.ts): its tools file, and the workspace
   * path the verifier reads their dispatch log at.
   */
  tools?: { file: string; dispatches: string }
  /** The run's epoch, which the workspace's clock starts at (clock.ts). */
  epoch?: string
}

interface MountBlock {
  vfs: string
  mode: string
  read?: string
  config: { root?: string }
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

/** The mounts with a host directory: disk mounts, not a service's (`/gmail`). */
function onDisk(mounts: Record<string, MountBlock>): [string, MountBlock & { config: { root: string } }][] {
  return Object.entries(mounts).filter((e): e is [string, MountBlock & { config: { root: string } }] => e[1].vfs === 'disk')
}

/** A workspace path's host file, through the disk mount it is in. */
function hostPath(mounts: Record<string, MountBlock>, path: string): string | undefined {
  const [prefix, mount] =
    onDisk(mounts)
      .filter(([m]) => path === m || path.startsWith(`${m}/`))
      .sort(([a], [b]) => b.length - a.length)[0] ?? []
  return prefix === undefined ? undefined : join(mount!.config.root, relative(prefix, path))
}

async function main(): Promise<void> {
  // Every run is in UTC, as harness/execute.ts runs it; the fakes inherit it.
  process.env.TZ = 'UTC'
  const { values } = parseArgs({ options: { task: { type: 'string' }, run: { type: 'string' }, fakes: { type: 'string' } } })
  if (values.task === undefined || values.run === undefined) throw new Error('usage: mocks.ts --task <dir> --run <dir> [--fakes <json>]')
  const runDir = resolve(values.run)
  mkdirSync(runDir, { recursive: true })
  const run = new Run(basename(runDir), runDir)
  const task = resolve(values.task)
  const external = JSON.parse(values.fakes ?? '{}') as Record<string, mirage.External>
  const plan = mirage.plan(task, run, external)

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
    await prepare(plan, run, external)
  } catch (error) {
    await stop()
    throw error
  }
}

/** Lay out the run's directories, start the fakes and write the plan. */
async function prepare(plan: Plan, run: Run, external: Record<string, mirage.External>): Promise<void> {
  const runDir = run.dir
  const config = interpolate(parse(readFileSync(join(HERE, 'workspace.yaml'), 'utf8')) as Record<string, unknown>, {
    RUN_DIR: runDir,
    PYTHON_PACKAGES: join(STATE, 'python'),
  })
  const mounts = config.mounts as Record<string, MountBlock>
  // A task's mount at a path of workspace.yaml's replaces it only where its
  // `replace` names the path (DataSpace's read-only `/workspace`).
  type Added = { mounts?: Record<string, MountBlock>; replace?: string[] }
  const { mounts: added = {}, replace = [], ...rest } = (plan.workspace ?? {}) as Added
  for (const path of replace) {
    if (added[path] === undefined) throw new Error(`${plan.name}: the task replaces ${path} with no mount of its own`)
  }
  for (const [path, mount] of Object.entries(added)) {
    if (mounts[path] !== undefined && !replace.includes(path)) {
      throw new Error(`${plan.name}: the task's mount ${path} is already workspace.yaml's`)
    }
    mounts[path] = mount
  }
  Object.assign(config, rest)
  // A state file outside every mount gets its directory mounted read-only,
  // parents first, so a nested one lands in its parent's mount.
  // The tools' dispatch log, which the daemon appends to, is read as a
  // service's state file is.
  const dispatches = join(runDir, 'dispatches.jsonl')
  if (plan.tools !== undefined) {
    writeFileSync(dispatches, '')
    plan.state[plan.tools.dispatches] = dispatches
  }
  // Files a shared fake keeps beside its run (mocks/upstream), read as a
  // service's state file is.
  for (const fake of Object.values(external) as (mirage.External & { files?: Record<string, string> })[]) {
    for (const [view, live] of Object.entries(fake.files ?? {})) plan.state[view] = live
  }
  const state: [string, string][] = []
  for (const [path, live] of Object.entries(plan.state).sort(([a], [b]) => dirname(a).length - dirname(b).length)) {
    if (hostPath(mounts, path) === undefined) {
      mounts[dirname(path)] = { vfs: 'disk', mode: 'read', read: 'fresh', config: { root: join(runDir, 'state', dirname(path)) } }
    }
    state.push([hostPath(mounts, path)!, live])
  }
  for (const [, mount] of onDisk(mounts)) mkdirSync(mount.config.root, { recursive: true })
  copyInto(plan.copies, (path) => hostPath(mounts, path), plan.name)
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
        mounts: Object.fromEntries(onDisk(mounts).map(([path, m]) => [path, { root: m.config.root, mode: m.mode }])),
        state,
        routes: Object.fromEntries(
          Object.entries(plan.routes).map(([port, name]) => [port, run.fakes.get(name)?.url ?? external[name]!.url]),
        ),
        // The shared fakes' runs, which this trial's mounts and CLIs reach
        // directly; nothing else on those ports is reachable.
        allow: Object.values(external).map((e) => e.url),
        run: plan.run,
        workdir: plan.workdir ?? '/',
        ...(plan.tools === undefined ? {} : { tools: { file: plan.tools.file, dispatches } }),
        ...(plan.epoch === undefined ? {} : { epoch: plan.epoch }),
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
