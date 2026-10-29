/**
 * The LiveClawBench adapter of harbor/mocks.ts: an upstream task directory
 * to the mocks it runs, the files they keep their state in and what its
 * Dockerfile sets.
 *
 * Upstream builds one image per task, `FROM liveclawbench-<task>-base`. It
 * runs the mocks `task-binary-map.json` lists for the task, each on its
 * fixed port, seeded for the task by `TASK_NAME`
 * (`scripts/build-task-images.ts`). Here each mock runs as
 * `liveclawbench/index.ts` runs it, under Bun on a free port, and the plan
 * routes its upstream port there. The task's own Dockerfile then adds
 * `ENV`, `COPY <src> <dest>` (from its `environment/`), `WORKDIR` and
 * `RUN`, whose lines run in the workspace once it opens; any other
 * instruction is refused, since nothing here can carry it out.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { FakeSpec } from '../harness/fakes.ts'
import type { Run } from '../harness/runs.ts'
import { DATA, PLATFORM, fake, fakeName } from '../liveclawbench/index.ts'
import { copyTarget } from './mirage.ts'
import type { Plan } from './mocks.ts'

/**
 * Each mock's ports in upstream's task images: its `BINARY_PORTS` entry,
 * then any legacy port the startup script proxies to it. Only the mocks
 * `DATA` lays out are listed.
 */
const PORTS: Record<string, number[]> = {
  chat: [5003],
  email: [5001, 5174],
  finance: [1235],
  'mint-diet': [5003],
  shop: [1234],
  weather: [3000],
}

/** A per-task image's base, which names the task. */
const BASE = /^liveclawbench-([a-z0-9-]+)-base(?::\S+)?$/

/** `COPY <src> <dest>`, with no flags: a source in the build context, `environment/`. */
const COPY = /^([^-\s]\S*)\s+(\S+)$/

interface Mapping {
  binaries: string[]
  startup_extra?: string
  extraSeeds?: unknown[]
}

/** The Dockerfile's instructions, each with its continuation lines joined. */
function instructions(text: string): { op: string; args: string; line: string }[] {
  const out: { op: string; args: string; line: string }[] = []
  let pending = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (pending === '' && (line === '' || line.startsWith('#'))) continue
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1)} `
      continue
    }
    const whole = (pending + line).trim()
    pending = ''
    const [op, ...rest] = whole.split(/\s+/)
    out.push({ op: op!.toUpperCase(), args: rest.join(' '), line: whole })
  }
  return out
}

/** `ENV A=1 B=2` or `ENV A 1`, quotes removed. */
function envPairs(args: string): [string, string][] {
  const unquote = (v: string) => v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  if (!/^\S+=/.test(args)) {
    const [name, ...value] = args.split(/\s+/)
    return [[name!, unquote(value.join(' '))]]
  }
  return [...args.matchAll(/(\S+?)=("[^"]*"|'[^']*'|\S*)/g)].map((m) => [m[1]!, unquote(m[2]!)])
}

/**
 * The plan for an upstream task directory.
 *
 * Throws, naming the cause, for a task this cannot run: one whose image is
 * not a LiveClawBench per-task one, a mock with no data layout here, a
 * legacy startup script, or a Dockerfile instruction other than the ones
 * above.
 */
export function plan(taskDir: string, run: Run): Plan {
  const environmentDir = join(taskDir, 'environment')
  const steps = instructions(readFileSync(join(environmentDir, 'Dockerfile'), 'utf8'))
  const from = steps[0]?.op === 'FROM' ? BASE.exec(steps[0].args) : null
  if (from === null) throw new Error(`${environmentDir}/Dockerfile is not FROM liveclawbench-<task>-base`)
  const task = from[1]!
  const map = JSON.parse(readFileSync(join(PLATFORM, 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, Mapping>
  }
  const mapping = map.tasks[task]
  if (mapping === undefined) throw new Error(`${task} is not in task-binary-map.json`)
  if (mapping.startup_extra !== undefined) throw new Error(`${task} runs a legacy startup script, which is not supported`)
  if ((mapping.extraSeeds ?? []).length > 0) throw new Error(`${task} has extra seeds, which are not supported`)
  for (const mock of mapping.binaries) {
    if (DATA[mock] === undefined || PORTS[mock] === undefined) throw new Error(`${task}: no data layout for mock '${mock}'`)
  }

  // Each mock's data files in the run, by the path upstream's image keeps them at.
  const layout = Object.fromEntries(mapping.binaries.map((mock) => [mock, DATA[mock]!(run.path('mock-data', mock))]))
  const env: Record<string, string> = { TASK_NAME: task }
  const mockEnv: Record<string, string> = {}
  // Read first: an `ENV` may name a file a later `COPY` puts there.
  const copies: Record<string, string> = {}
  for (const { op, args } of steps) {
    const copy = op === 'COPY' ? COPY.exec(args) : null
    if (copy === null) continue
    const from = join(environmentDir, copy[1]!)
    if (relative(environmentDir, from).startsWith('..')) throw new Error(`${task}: COPY ${copy[1]} is outside environment/`)
    copies[copyTarget(copy[2]!, from)] = from
  }
  const lines: { cwd: string; line: string }[] = []
  let workdir: string | undefined
  for (const { op, args, line } of steps.slice(1)) {
    if (op === 'COPY' && COPY.test(args)) continue
    if (op === 'ENV') {
      for (const [name, value] of envPairs(args)) {
        // The workspace sees the value as the container does.
        env[name] = value
        const owner = Object.values(layout).find((data) => name in data.env)
        if (owner !== undefined) {
          // A mock's own data path, which the run's layout replaces.
          if (!Object.keys(owner.files).some((path) => path === value || path.startsWith(`${value}/`))) {
            throw new Error(`${task}: ENV ${name}=${value} is not where index.ts's DATA keeps that mock's data`)
          }
          continue
        }
        const copied = Object.keys(copies).find((dir) => value.startsWith(`${dir}/`))
        mockEnv[name] = copied === undefined ? value : join(copies[copied]!, value.slice(copied.length + 1))
      }
    } else if (op === 'RUN' && !args.startsWith('[')) {
      lines.push({ cwd: workdir ?? '/', line: args })
    } else if (op === 'WORKDIR') {
      workdir = args
    } else if (!['USER', 'HEALTHCHECK', 'CMD', 'EXPOSE', 'LABEL'].includes(op)) {
      throw new Error(`${task}: Dockerfile instruction '${line}' is not supported`)
    }
  }

  const fakes: FakeSpec[] = []
  const routes: Record<number, string> = {}
  const state: Record<string, string> = {}
  for (const mock of mapping.binaries) {
    const spec = fake(run, { task, mocks: mapping.binaries, rewrite: {} }, mock)
    fakes.push({ ...spec, env: { ...spec.env, ...mockEnv } })
    for (const port of PORTS[mock]!) {
      if (routes[port] !== undefined) throw new Error(`${task}: port ${port} is both ${routes[port]} and ${fakeName(mock)}`)
      routes[port] = fakeName(mock)
    }
    Object.assign(state, layout[mock]!.files)
  }
  return { name: task, fakes, routes, state, env, copies, run: lines, ...(workdir === undefined ? {} : { workdir }) }
}
