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
 *         state: /opt/mock/data/chat/chat.sqlite  # where its SQLite is read
 *     env: {TASK_NAME: chat-sticker-engagement}
 *     copy:                      # COPY . <dir>: entries of environment/
 *       /workspace/environment: [notes]
 *     run: [mkdir -p /workspace/output]   # RUN lines, in the workspace
 *     workdir: /workspace        # WORKDIR, if any
 *     workspace:                 # added to harbor/workspace.yaml
 *       mounts: {/gmail: {vfs: gmail, config: {apiBase: '${GWS_URL}'}}}
 *       clis: {gws: {cli: gws, config: {apiBase: '${GWS_URL}'}}}
 *
 * The environment starts the fakes and resets this trial's run on each
 * before mocks.ts runs, and hands their run URLs and files in (`external`).
 * `${<SERVICE>_URL}` in `workspace` is that service's run URL.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { parse } from 'yaml'

import type { Run } from '../harness/runs.ts'
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
  state?: string
}

interface MirageYaml {
  fakes: Record<string, FakeBlock>
  env?: Record<string, string>
  copy?: Record<string, string[]>
  run?: string[]
  workdir?: string
  workspace?: Record<string, unknown>
}

const KEYS = new Set(['fakes', 'env', 'copy', 'run', 'workdir', 'workspace'])

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
            if (vars[name] === undefined) throw new Error(`${where} names \${${name}}, which is no fake's run`)
            return vars[name]!
          })
        : v,
    ),
  ) as T
}

/** The plan for a task with a mirage.yaml, over its fakes' runs. */
export function plan(taskDir: string, _run: Run, external: Record<string, External>): Plan {
  const path = file(taskDir)!
  const spec = parse(readFileSync(path, 'utf8')) as MirageYaml
  const unknown = Object.keys(spec).filter((k) => !KEYS.has(k))
  if (unknown.length > 0) throw new Error(`${path}: unknown keys ${unknown.join(', ')}`)
  const environmentDir = join(taskDir, 'environment')
  const routes: Record<number, string> = {}
  const state: Record<string, string> = {}
  for (const [service, fake] of Object.entries(spec.fakes)) {
    const run = external[service]
    if (run === undefined) throw new Error(`${path}: the environment started no '${service}' fake`)
    for (const port of fake.ports ?? []) {
      if (routes[port] !== undefined) throw new Error(`${path}: port ${port} is both ${routes[port]} and ${service}`)
      routes[port] = service
    }
    if (fake.state !== undefined) state[fake.state] = run.db
  }
  const copies: Record<string, string | null> = {}
  for (const [dir, entries] of Object.entries(spec.copy ?? {})) {
    if (entries.length === 0) copies[dir] = null
    for (const entry of entries) copies[`${dir.replace(/\/$/, '')}/${entry}`] = join(environmentDir, entry)
  }
  const vars = Object.fromEntries(Object.entries(external).map(([service, run]) => [`${service.toUpperCase()}_URL`, run.url]))
  return {
    name: spec.env?.TASK_NAME ?? basename(taskDir),
    fakes: [],
    routes,
    state,
    env: spec.env ?? {},
    copies,
    run: (spec.run ?? []).map((line) => ({ cwd: spec.workdir ?? '/', line })),
    ...(spec.workdir === undefined ? {} : { workdir: spec.workdir }),
    ...(spec.workspace === undefined ? {} : { workspace: interpolate(spec.workspace, vars, path) }),
  }
}
