/**
 * Start the fake services one run needs, each its own process.
 *
 * Every fake follows the Mirage integ kit's contract: it prints
 * `<NAME>_URL=<url>` once it is seeded and listening, and empties and
 * reseeds on `POST /reset`. Two kinds are built in:
 *
 * - `kit`: a Mirage integ fake, or one under `fakes/<service>/`, keeping its
 *   state in SQLite under its own TMPDIR.
 * - `bridge`: a Python world served by `bridge/server.py`, for benchmarks
 *   whose apps are Python simulations.
 *
 * Every run starts its own processes on free ports, so two runs never share
 * state.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import { INTEG, ROOT } from './paths.ts'
import type { Run } from './runs.ts'

export interface FakeSpec {
  /** Names the fake; its URL lands in the run env as `<NAME>_URL`. */
  name: string
  argv: string[]
  cwd?: string
  env?: Record<string, string>
  /** Seconds to wait for the ready line. */
  readyTimeout?: number
}

const READY = /^([A-Z0-9_]+)_URL=(\S+)$/

/**
 * The model's credentials, which stay with the harness. Given them, an
 * upstream simulation may call the real API mid-run, as AutomationBench's
 * ChatGPT app does.
 */
const MODEL_ENV = new Set(['OPENAI_API_KEY', 'OPENAI_BASE_URL'])

/** A running fake. */
export class Fake {
  readonly log: string[] = []
  url = ''
  readonly name: string
  readonly process: ChildProcess
  /** Its TMPDIR, where a kit fake keeps its SQLite. */
  readonly stateDir: string

  constructor(name: string, process: ChildProcess, stateDir: string) {
    this.name = name
    this.process = process
    this.stateDir = stateDir
  }

  /** POST a JSON body to a path on the fake. */
  async post(path: string, body: unknown): Promise<unknown> {
    const reply = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await reply.text()
    if (!reply.ok) throw new Error(`${this.name} ${path}: ${reply.status} ${text}`)
    return text === '' ? null : JSON.parse(text)
  }

  async get(path: string): Promise<unknown> {
    const reply = await fetch(`${this.url}${path}`)
    const text = await reply.text()
    if (!reply.ok) throw new Error(`${this.name} ${path}: ${reply.status} ${text}`)
    return JSON.parse(text)
  }

  /** Empty the fake and reseed it, as the kit's `/reset` does. */
  reset(body: { fixture?: unknown; epoch?: string; tenants?: string[] } = {}): Promise<unknown> {
    return this.post('/reset', body)
  }

  /** Every table of a kit fake's SQLite run file, rows sorted. */
  tables(run = 'default'): Promise<Tables> {
    return sqliteTables(kitDatabase(this.stateDir, run))
  }

  async stop(): Promise<void> {
    if (this.process.exitCode === null && this.process.signalCode === null) {
      const exited = new Promise((resolve) => this.process.once('exit', resolve))
      const closed = new Promise((resolve) => this.process.once('close', resolve))
      this.process.kill('SIGTERM')
      const timer = setTimeout(() => this.process.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(timer)
      // The rest of what it printed on the way down, unless something it
      // left running holds its output open.
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000).unref())])
    }
    rmSync(this.stateDir, { recursive: true, force: true })
  }
}

export type Tables = Record<string, Record<string, unknown>[]>

/** Every table of a SQLite file but SQLite's own and `_`-prefixed ones, rows sorted. */
export async function sqliteTables(file: string): Promise<Tables> {
  // Imported here, not at the top: node:sqlite warns that it is
  // experimental on import, and most runs read no SQLite.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'")
      .all() as { name: string }[]
    const out: Tables = {}
    for (const { name } of names) {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]
      out[name] = rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    return out
  } finally {
    db.close()
  }
}

/** The kit's run file: `<TMPDIR>/mirage-kit-<service>-<id>-/<run>.db`. */
function kitDatabase(stateDir: string, run: string): string {
  for (const entry of readdirSync(stateDir)) {
    const file = join(stateDir, entry, `${run}.db`)
    if (entry.startsWith('mirage-kit-') && existsSync(file)) return file
  }
  throw new Error(`no kit database for run '${run}' under ${stateDir}`)
}

/**
 * Start one fake and wait for its ready line.
 *
 * Its TMPDIR is a short system temp directory, not one under the run: tsx
 * opens a Unix socket there, and a socket path may be only about 100 bytes.
 */
export async function start(spec: FakeSpec, run: Run): Promise<Fake> {
  const stateDir = mkdtempSync(join(tmpdir(), `vfsbench-${spec.name.toLowerCase()}-`))
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !MODEL_ENV.has(name))),
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    TMPDIR: stateDir,
    ...spec.env,
  }
  const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
    cwd: spec.cwd ?? ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const fake = new Fake(spec.name, child, stateDir)
  run.fakes.set(spec.name, fake)
  createInterface({ input: child.stderr! }).on('line', (line) => fake.log.push(line))
  const lines = createInterface({ input: child.stdout! })
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${spec.name} not ready after ${spec.readyTimeout ?? 120}s:\n${fake.log.slice(-40).join('\n')}`)),
      (spec.readyTimeout ?? 120) * 1000,
    )
    lines.on('line', (line) => {
      fake.log.push(line)
      const match = READY.exec(line.trim())
      if (match !== null && fake.url === '') {
        clearTimeout(timer)
        resolve(match[2]!)
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${spec.name} exited (${code}) before it was ready:\n${fake.log.slice(-40).join('\n')}`))
    })
  })
  fake.url = url
  run.env[`${spec.name}_URL`] = url
  return fake
}

/**
 * A Mirage integ kit fake, seeded from `<run>/fixtures/<service>/<fixture>.json`.
 *
 * `entry` defaults to Mirage's own fake for the service; a fake of this
 * repo's lives at `fakes/<service>/main.ts`.
 */
export function kit(run: Run, service: string, fixture: string, entry?: string): FakeSpec {
  return {
    name: service.toUpperCase(),
    argv: [
      join(INTEG, 'node_modules', '.bin', 'tsx'),
      entry ?? join(INTEG, 'server', service, 'main.ts'),
      '--port', '0',
      '--fixture-root', run.fixtureRoot,
      '--fixture', fixture,
    ],
    cwd: INTEG,
  }
}

/**
 * A Python world served by `bridge/server.py`, run in the dataset's own uv
 * project so each dataset keeps its own dependencies.
 *
 * Args:
 *   project: the dataset directory, which holds its pyproject.toml and the
 *     world's module.
 *   world: `module:Class`, importable from `project`.
 *   config: handed to the world's constructor.
 */
export function bridge(name: string, project: string, world: string, config: unknown = {}): FakeSpec {
  return {
    name,
    argv: [
      'uv', 'run', '--quiet', '--project', project, 'python', '-I',
      join(ROOT, 'bridge', 'server.py'),
      '--name', name, '--world', world, '--path', project,
      '--config', JSON.stringify(config),
    ],
    cwd: project,
  }
}

/** Write `<fixture root>/<service>/<name>.json` for a kit fake to seed from. */
export function writeFixture(run: Run, service: string, name: string, body: unknown): void {
  const dir = join(run.fixtureRoot, service)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 1))
}
