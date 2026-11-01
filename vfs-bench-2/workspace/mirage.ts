/**
 * Lay out one trial's Mirage workspace from its task's `workspace/`, for
 * vfsbench_harbor's MirageEnvironment.
 *
 *     node workspace/mirage.ts --workspace <task>/workspace --run <run dir> [--fakes <json>]
 *
 * It reads `workspace.yaml`, fills the run's directories, and writes
 * `<run>/plan.json`: the Mirage workspace config to create, each mount's
 * host directory, the fakes' state files, the routes from upstream's ports
 * to the fakes and the `run` lines. It prints `PLAN=<path>` once done.
 *
 *     fakes:                     # kit fakes, shared by every trial of a job
 *       chat:
 *         fixture: fixtures/chat.json   # the run's seed, in workspace/
 *         epoch: '2026-04-03T09:00:00Z' # the run's frozen clock
 *         ports: [5003]                 # localhost:<port> reaches the run
 *         state: /opt/mock/data/chat/chat.sqlite  # where its SQLite is read
 *         faults: [{method: POST, route: /api/stickers, status: 500}]
 *                                       # kit fault plans armed on the run
 *     env: {TASK_NAME: chat-sticker-engagement}
 *     copy:                      # entries of files/, to a destination
 *       /workspace/environment: [notes]
 *       /workspace/policies: policies/  # one source, in files/
 *       /workspace:              # several sources to one destination, in order
 *         - {src: policies/}
 *         - {src: ., entries: [notes]}
 *     run: [mkdir -p /workspace/output]   # lines run in the workspace once it opens
 *     workdir: /workspace        # where a command runs by default
 *     workspace:                 # added to workspace/workspace.yaml
 *       mounts: {/gmail: {vfs: gmail, config: {apiBase: '${GWS_URL}'}}}
 *       clis: {gws: {cli: gws, config: {apiBase: '${GWS_URL}'}}}
 *     tools:                     # the task's own tools, as CLIs (tools.ts)
 *       file: tools.json         # in workspace/; `clis:` installs each
 *       dispatches: /var/lib/mock-data/tools/dispatches.jsonl
 *                                # where the verifier reads their calls
 *
 * The fakes' epoch (one for all) is the run's, which the workspace's clock
 * starts at too (the environment sends it as `system_time`).
 *
 * The environment starts the fakes and resets this trial's run on each
 * before this runs, and hands their run URLs and files in (`--fakes`).
 * `${<SERVICE>_URL}` in `workspace` is that service's run URL, and
 * `${RUN_DIR}` the trial's run dir, under which a mount the task adds keeps
 * its files (`/home/node: {vfs: disk, config: {root: '${RUN_DIR}/home'}}`),
 * and `${WORKSPACE}` the task's `workspace/` (DataSpace mounts its context
 * from `${WORKSPACE}/files/context`).
 * `${STATE}` is vfs-bench-2's `state/`, where download.py downloads upstream.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { parse, stringify } from 'yaml'

import { type Copy, copyInto, copyTarget } from './copies.ts'
import { STATE } from './paths.ts'

/** What a task's workspace needs, as plan() reads it from workspace.yaml. */
export interface Plan {
  /** The upstream task, which names the run. */
  name: string
  /** Each port the task reaches a fake at on localhost, and the fake's name. */
  routes: Record<number, string>
  /** Each file a fake keeps its state in, by the workspace path the task reads it at. */
  state: Record<string, string>
  /** The environment every command sees, as the container's. */
  env: Record<string, string>
  /** Host paths copied into the workspace, in workspace.yaml's order (copies.ts). */
  copies: Copy[]
  /**
   * workspace.yaml's `run` lines, each with the directory it runs in, which
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
  /** The run's epoch, which the workspace's clock starts at (`system_time`). */
  epoch?: string
}

interface MountBlock {
  vfs: string
  mode: string
  read?: string
  config: { root?: string }
}

/** A shared fake's run, as the environment reset it for this trial. */
export interface External {
  /** The run's base URL, `<fake>/_run/<run>`. */
  url: string
  /** The run's SQLite file. */
  db: string
}

interface FakeBlock {
  fixture: string
  epoch?: string
  ports?: number[]
  state?: string
  /** Armed by the environment, not here (fakes.py). */
  faults?: unknown[]
}

interface MirageYaml {
  fakes: Record<string, FakeBlock>
  env?: Record<string, string>
  copy?: Record<string, CopyValue>
  run?: string[]
  workdir?: string
  workspace?: Record<string, unknown>
  tools?: { file: string; dispatches: string }
}

/**
 * A destination's copies: entries of files/, one source in files/, or
 * several of either to it, in order.
 */
type CopyValue = string[] | string | { src: string; entries?: string[] }[]

const KEYS = new Set(['fakes', 'env', 'copy', 'run', 'workdir', 'workspace', 'tools'])

/** Each `${NAME}` in the value's strings, from `vars`; a name unset is an error. */
function interpolate<T>(value: T, vars: Record<string, string>, where: string): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === 'string'
        ? v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => {
            if (vars[name] === undefined) throw new Error(`${where} names \${${name}}, which is not a fake's run, RUN_DIR, WORKSPACE or STATE`)
            return vars[name]!
          })
        : v,
    ),
  ) as T
}

/** A destination's copies, as workspace.yaml states them, in order. */
function copiesOf(dest: string, value: CopyValue, filesDir: string, where: string): Copy[] {
  const source = (src: string): Copy => {
    const from = join(filesDir, src)
    if (relative(filesDir, from).startsWith('..')) throw new Error(`${where}: copy ${src} is outside files/`)
    return { to: copyTarget(dest, from), from }
  }
  const everything = (entries: string[]): Copy[] =>
    entries.length === 0
      ? [{ to: dest.replace(/\/$/, ''), from: null }]
      : entries.map((entry) => ({ to: `${dest.replace(/\/$/, '')}/${entry}`, from: join(filesDir, entry) }))
  if (typeof value === 'string') return [source(value)]
  if (value.every((v) => typeof v === 'string')) return everything(value as string[])
  return (value as { src: string; entries?: string[] }[]).flatMap((step) =>
    step.src === '.' ? everything(step.entries ?? []) : [source(step.src)],
  )
}

/** The plan for a task's workspace/, over its fakes' runs. */
export function plan(workspaceDir: string, runDir: string, external: Record<string, External>): Plan {
  const path = join(workspaceDir, 'workspace.yaml')
  const spec = parse(readFileSync(path, 'utf8')) as MirageYaml
  const unknown = Object.keys(spec).filter((k) => !KEYS.has(k))
  if (unknown.length > 0) throw new Error(`${path}: unknown keys ${unknown.join(', ')}`)
  const filesDir = join(workspaceDir, 'files')
  const routes: Record<number, string> = {}
  const state: Record<string, string> = {}
  for (const [service, fake] of Object.entries(spec.fakes)) {
    const run = external[service]
    if (run === undefined) throw new Error(`${path}: the environment started no '${service}' fake`)
    for (const port of fake.ports ?? []) {
      const taken = routes[port]
      if (taken !== undefined) throw new Error(`${path}: port ${port} is both ${taken} and ${service}`)
      routes[port] = service
    }
    if (fake.state !== undefined) state[fake.state] = run.db
  }
  // The run's clock, which the workspace's follows: every fake's is one.
  const epochs = [...new Set(Object.values(spec.fakes).flatMap((fake) => (fake.epoch === undefined ? [] : [fake.epoch])))]
  if (epochs.length > 1) throw new Error(`${path}: the fakes' epochs differ (${epochs.join(', ')})`)
  const copies = Object.entries(spec.copy ?? {}).flatMap(([dest, value]) => copiesOf(dest, value, filesDir, path))
  const vars: Record<string, string> = {
    ...Object.fromEntries(Object.entries(external).map(([service, fake]) => [`${service.toUpperCase()}_URL`, fake.url])),
    RUN_DIR: runDir,
    WORKSPACE: workspaceDir,
    STATE,
  }
  return {
    name: spec.env?.TASK_NAME ?? basename(dirname(workspaceDir)),
    routes,
    state,
    env: spec.env ?? {},
    copies,
    run: (spec.run ?? []).map((line) => ({ cwd: spec.workdir ?? '/', line })),
    ...(spec.workdir === undefined ? {} : { workdir: spec.workdir }),
    ...(spec.workspace === undefined ? {} : { workspace: interpolate(spec.workspace, vars, path) }),
    ...(spec.tools === undefined
      ? {}
      : { tools: { file: join(workspaceDir, spec.tools.file), dispatches: spec.tools.dispatches } }),
    ...(epochs.length === 0 ? {} : { epoch: epochs[0] }),
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))

/** Each `${NAME}` in the base config's strings, from `vars`. */
function interpolateBase<T>(value: T, vars: Record<string, string>): T {
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
  // Every run is in UTC; the fakes inherit it.
  process.env.TZ = 'UTC'
  const { values } = parseArgs({ options: { workspace: { type: 'string' }, run: { type: 'string' }, fakes: { type: 'string' } } })
  if (values.workspace === undefined || values.run === undefined) {
    throw new Error('usage: mirage.ts --workspace <task>/workspace --run <dir> [--fakes <json>]')
  }
  const runDir = resolve(values.run)
  mkdirSync(runDir, { recursive: true })
  const external = JSON.parse(values.fakes ?? '{}') as Record<string, External>
  prepare(plan(resolve(values.workspace), runDir, external), runDir, external)
}

/** Lay out the run's directories and write the plan. */
function prepare(plan: Plan, runDir: string, external: Record<string, External>): void {
  const config = interpolateBase(parse(readFileSync(join(HERE, 'workspace.yaml'), 'utf8')) as Record<string, unknown>, {
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
  for (const fake of Object.values(external) as (External & { files?: Record<string, string> })[]) {
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
  writeFileSync(join(runDir, 'workspace.yaml'), `# ${plan.name}, generated by workspace/mirage.ts.\n${stringify(config)}`)

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
          Object.entries(plan.routes).map(([port, name]) => [port, external[name]!.url]),
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

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error((error as Error).stack ?? String(error))
    process.exit(1)
  })
}
