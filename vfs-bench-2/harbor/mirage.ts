/**
 * The adapter of harbor/mocks.ts for a task that states its environment in
 * `environment/mirage.yaml`, in place of a Dockerfile: the tasks committed
 * under `harbor/tasks/`.
 *
 *     fakes:                     # kit fakes, shared by every trial of a job
 *       chat:
 *         fixture: fixtures/chat.json   # the run's seed, from environment/
 *         epoch: '2026-04-03T09:00:00Z' # the run's frozen clock
 *         ports: [5003]                 # localhost:<port> reaches the run
 *         verifierPorts: [8001]         # the same, for a verifier outside
 *                                       # the workspace alone (microsandbox.py)
 *         state: /opt/mock/data/chat/chat.sqlite  # where its SQLite is read
 *         faults: [{method: POST, route: /api/stickers, status: 500}]
 *                                       # kit fault plans armed on the run
 *     env: {TASK_NAME: chat-sticker-engagement}
 *     copy:                      # COPY . <dir>: entries of environment/
 *       /workspace/environment: [notes]
 *       /workspace/policies: policies/  # COPY <src> <dest>: src, in environment/
 *       /workspace:              # several COPYs to one <dest>, in order
 *         - {src: policies/}
 *         - {src: ., entries: [notes]}
 *     run: [mkdir -p /workspace/output]   # RUN lines, in the workspace
 *     workdir: /workspace        # WORKDIR, if any
 *     workspace:                 # added to harbor/workspace.yaml
 *       mounts: {/gmail: {vfs: gmail, config: {apiBase: '${GWS_URL}'}}}
 *       clis: {gws: {cli: gws, config: {apiBase: '${GWS_URL}'}}}
 *     tools:                     # the task's own tools, as CLIs (tools.ts)
 *       file: tools.json         # in environment/; `clis:` installs each
 *       dispatches: /var/lib/mock-data/tools/dispatches.jsonl
 *                                # where the verifier reads their calls
 *     verifier:                  # for MicrosandboxVerifier's VM
 *       copy: {/opt/claweval: '${STATE}/claweval/src'}
 *                                # host directories it gets, by VM path
 *       egress: [OPENAI_BASE_URL]  # variables whose URLs' hosts it reaches
 *
 * The fakes' epoch (one for all) is the run's, which the workspace's clock
 * starts at too (clock.ts).
 *
 * The environment starts the fakes and resets this trial's run on each
 * before mocks.ts runs, and hands their run URLs and files in (`external`).
 * `${<SERVICE>_URL}` in `workspace` is that service's run URL, and
 * `${RUN_DIR}` the trial's run dir, under which a mount the task adds keeps
 * its files (`/home/node: {vfs: disk, config: {root: '${RUN_DIR}/home'}}`).
 * `${STATE}` in `verifier.copy` is vfs-bench-2's `state/`, where setup
 * downloads upstream.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { parse } from 'yaml'

import { STATE } from '../harness/paths.ts'
import type { Run } from '../harness/runs.ts'
import { type Copy, copyTarget } from './copies.ts'
import type { Plan } from './mocks.ts'

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
  verifierPorts?: number[]
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
  verifier?: Verifier
}

/** What a verifier outside the workspace gets besides the trial's files (microsandbox.py). */
export interface Verifier {
  copy?: Record<string, string>
  egress?: string[]
}

/**
 * A destination's copies: `COPY . <dest>`'s entries of environment/, one
 * `COPY <src> <dest>`'s source, or several COPYs to it, in order.
 */
type CopyValue = string[] | string | { src: string; entries?: string[] }[]

const KEYS = new Set(['fakes', 'env', 'copy', 'run', 'workdir', 'workspace', 'tools', 'verifier'])

/** The task's mirage.yaml, if it has one. */
export function file(taskDir: string): string | undefined {
  const path = join(taskDir, 'environment', 'mirage.yaml')
  return existsSync(path) ? path : undefined
}

/** Each `${NAME}` in the value's strings, from `vars`; a name unset is an error. */
function interpolate<T>(value: T, vars: Record<string, string>, where: string): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === 'string'
        ? v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => {
            if (vars[name] === undefined) throw new Error(`${where} names \${${name}}, which is not a fake's run, RUN_DIR or STATE`)
            return vars[name]!
          })
        : v,
    ),
  ) as T
}

/** A destination's copies, as mirage.yaml states them, in order. */
function copiesOf(dest: string, value: CopyValue, environmentDir: string, where: string): Copy[] {
  const source = (src: string): Copy => {
    const from = join(environmentDir, src)
    if (relative(environmentDir, from).startsWith('..')) throw new Error(`${where}: COPY ${src} is outside environment/`)
    return { to: copyTarget(dest, from), from }
  }
  const everything = (entries: string[]): Copy[] =>
    entries.length === 0
      ? [{ to: dest.replace(/\/$/, ''), from: null }]
      : entries.map((entry) => ({ to: `${dest.replace(/\/$/, '')}/${entry}`, from: join(environmentDir, entry) }))
  if (typeof value === 'string') return [source(value)]
  if (value.every((v) => typeof v === 'string')) return everything(value as string[])
  return (value as { src: string; entries?: string[] }[]).flatMap((step) =>
    step.src === '.' ? everything(step.entries ?? []) : [source(step.src)],
  )
}

/** The plan for a task with a mirage.yaml, over its fakes' runs. */
export function plan(taskDir: string, run: Run, external: Record<string, External>): Plan {
  const path = file(taskDir)!
  const spec = parse(readFileSync(path, 'utf8')) as MirageYaml
  const unknown = Object.keys(spec).filter((k) => !KEYS.has(k))
  if (unknown.length > 0) throw new Error(`${path}: unknown keys ${unknown.join(', ')}`)
  const environmentDir = join(taskDir, 'environment')
  const routes: Record<number, string> = {}
  const verifierRoutes: Record<number, string> = {}
  const state: Record<string, string> = {}
  for (const [service, fake] of Object.entries(spec.fakes)) {
    const run = external[service]
    if (run === undefined) throw new Error(`${path}: the environment started no '${service}' fake`)
    for (const [port, only] of [
      ...(fake.ports ?? []).map((p) => [p, false] as const),
      ...(fake.verifierPorts ?? []).map((p) => [p, true] as const),
    ]) {
      const taken = routes[port] ?? verifierRoutes[port]
      if (taken !== undefined) throw new Error(`${path}: port ${port} is both ${taken} and ${service}`)
      ;(only ? verifierRoutes : routes)[port] = service
    }
    if (fake.state !== undefined) state[fake.state] = run.db
  }
  // The run's clock, which the workspace's follows: every fake's is one.
  const epochs = [...new Set(Object.values(spec.fakes).flatMap((fake) => (fake.epoch === undefined ? [] : [fake.epoch])))]
  if (epochs.length > 1) throw new Error(`${path}: the fakes' epochs differ (${epochs.join(', ')})`)
  const copies = Object.entries(spec.copy ?? {}).flatMap(([dest, value]) => copiesOf(dest, value, environmentDir, path))
  const vars: Record<string, string> = {
    ...Object.fromEntries(Object.entries(external).map(([service, fake]) => [`${service.toUpperCase()}_URL`, fake.url])),
    RUN_DIR: run.dir,
    STATE,
  }
  return {
    name: spec.env?.TASK_NAME ?? basename(taskDir),
    fakes: [],
    routes,
    verifierRoutes,
    state,
    env: spec.env ?? {},
    copies,
    run: (spec.run ?? []).map((line) => ({ cwd: spec.workdir ?? '/', line })),
    ...(spec.workdir === undefined ? {} : { workdir: spec.workdir }),
    ...(spec.workspace === undefined ? {} : { workspace: interpolate(spec.workspace, vars, path) }),
    ...(spec.tools === undefined
      ? {}
      : { tools: { file: join(environmentDir, spec.tools.file), dispatches: spec.tools.dispatches } }),
    ...(spec.verifier === undefined ? {} : { verifier: interpolate(spec.verifier, vars, path) }),
    ...(epochs.length === 0 ? {} : { epoch: epochs[0] }),
  }
}
