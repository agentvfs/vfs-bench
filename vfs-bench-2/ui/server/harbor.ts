/**
 * Harbor's job directories, read as the UI shows them, and the
 * `harbor run` processes the UI starts.
 *
 * Nothing here has a format of its own. A job is a directory Harbor wrote
 * under `state/harbor/<jobs dir>/<job name>/`, whoever started it: its
 * `config.json` and `lock.json` say what it runs, each trial's `result.json`
 * says how it ended, and a trial without one is still running. A run the
 * UI starts is `harbor run -c <config>`, the config being the dataset's
 * own YAML with the form's choices written over it, so the same job could
 * have been started from a shell.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, openSync, closeSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'

export interface Config {
  /** The YAML's path from the root, e.g. `harbor/gaia2.yaml`. */
  file: string
  dataset: string
  tasks: string[]
  /** Each task's directory, from the root. */
  paths: string[]
  environment: string | null
  verifier: string | null
}

/** A cancelled trial is not started: resuming or retrying runs it. */
export type CellState = 'not-started' | 'in-progress' | 'succeeded' | 'failed'

export interface Cell {
  task: string
  state: CellState
  reward: number | null
  /** Harbor's exception type, when the trial raised one. */
  error: string | null
  /** The trial directory this cell shows, relative to the jobs root. */
  trial: string | null
  /** 1 for the job's own trial, one more for each retry. */
  attempt: number
  /** The last commands its Mirage workspace ran, as Mirage's history records them. */
  commands: string[]
}

export type JobStatus = 'running' | 'done' | 'stopped' | 'starting'

export interface JobBrief {
  id: string
  name: string
  dataset: string
  agent: string
  model: string | null
  concurrency: number
  attempts: number
  status: JobStatus
  total: number
  finished: number
  /** Trials Harbor counts as running now. */
  running: number
  passed: number
  errored: number
  mean: number | null
  startedAt: string | null
  retryOf: string | null
  owned: boolean
}

export interface JobDetail extends JobBrief {
  command: string
  cells: Cell[]
  log: string | null
}

export interface TaskBrief {
  task: string
  /** task.toml's `[metadata]`: category, difficulty, upstream and the like. */
  metadata: Record<string, unknown>
  /** task.toml's `[agent]`, `[verifier]` and `[environment]` limits. */
  limits: Record<string, unknown>
  instruction: string
}

export interface RunRequest {
  config: string
  agent: string
  model?: string
  concurrency: number
  attempts: number
  /** Task-name globs, space-separated; empty runs every task. */
  filter?: string
}

const JOB_ID = /^[\w.-]+\/[\w.-]+$/
const RETRY = /__retry-(\d+)$/
const CANCELLED = 'CancelledError'

interface Launch {
  child: ChildProcess
  command: string
  log: string
  tasks: string[]
  stopping: boolean
}

async function json(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * The part of TOML that task.toml files use: `[section]` headers and
 * `key = value` lines with strings, numbers, booleans and flat arrays.
 */
export function parseToml(text: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = { '': {} }
  let section = ''
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      section = header[1].trim()
      out[section] ??= {}
      continue
    }
    const kv = line.match(/^([\w.-]+)\s*=\s*(.+)$/)
    if (!kv) continue
    let value: unknown = kv[2]
    try {
      value = JSON.parse(kv[2])
    } catch {
      value = kv[2].replace(/^['"]|['"]$/g, '')
    }
    out[section][kv[1]] = value
  }
  return out
}

/** `*` and `?` globs, as Harbor's own `-i` takes them. */
export function globs(filter: string | undefined): (name: string) => boolean {
  const patterns = (filter ?? '').split(/\s+/).filter(Boolean)
  if (!patterns.length) return () => true
  const res = patterns.map(
    (p) =>
      new RegExp(
        '^' +
          p
            .split('')
            .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
            .join('') +
          '$'
      )
  )
  return (name) => res.some((r) => r.test(name))
}

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `__${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  )
}

/** The job's agent: its config's, else its lock's (a config leaves out a default). */
function agentOf(config: any, lock: any): { agent: string; model: string | null } {
  const a = config?.agents?.[0] ?? lock?.trials?.[0]?.agent ?? {}
  return { agent: a.name ?? a.import_path ?? 'oracle', model: a.model_name ?? null }
}

/** The task a planned or started trial runs: the last part of its path. */
function taskOf(entry: any): string {
  const t = entry?.task ?? entry
  return basename(t?.path ?? t?.name ?? '?')
}

/**
 * A job's dataset: the `<dataset>` of `harbor/tasks/<dataset>[/<task>]`, or
 * of upstream's own tasks under `state/<dataset>/`; else the directory its
 * first task is in.
 */
function datasetOf(config: any): string {
  const path: string | undefined = config?.tasks?.[0]?.path ?? config?.datasets?.[0]?.path
  if (!path) return '?'
  const named = path.match(/(?:^|\/)harbor\/tasks\/([^/]+)/) ?? path.match(/(?:^|\/)state\/([^/]+)\//)
  return named ? named[1] : basename(dirname(path))
}

/** A trial's reward: Harbor's `reward`, or the first reward it has. */
function rewardOf(result: any): number | null {
  const rewards = result?.verifier_result?.rewards
  if (!rewards) return null
  const value = rewards.reward ?? Object.values(rewards)[0]
  return typeof value === 'number' ? value : null
}

/**
 * What the agent ran, from a workspace's histfile. Left out: the histfile's
 * `#<epoch>` stamps; the task's setup (`setup`, the `run` of the trial's
 * plan.json); the environment Harbor exports ahead of each exec; Harbor's
 * own steps around the agent (making the oracle's script executable,
 * checking for artifacts); and everything from the verifier's first step
 * on, which is grading. The oracle's run of its script loses the redirect
 * Harbor wraps it in.
 */
export function agentCommands(histfile: string, setup: string[] = []): string[] {
  const out: string[] = []
  for (const line of histfile.split('\n')) {
    if (/^rm -f -- \/logs\/verifier\/|^chmod \+x \/tests\//.test(line)) break
    if (!line.trim() || /^#\d+$/.test(line) || /^export \w+=/.test(line)) continue
    if (/^chmod \+x \/solution\/|^test -d \/logs\//.test(line) || setup.includes(line.trim())) continue
    out.push(line.replace(/^\((.+)\) > \/logs\/agent\/\S+ 2>&1$/, '$1').slice(0, 240))
  }
  return out.slice(-8)
}

export class Harbor {
  readonly root: string
  readonly jobsRoot: string
  private readonly configDir: string
  private readonly launches = new Map<string, Launch>()
  /** Jobs whose process this UI saw end: not running, whatever Harbor last wrote. */
  private readonly exited = new Set<string>()
  /** Each dataset's task catalogue, with the version of the config it was read from. */
  private readonly catalog = new Map<string, { version: string; tasks: TaskBrief[] }>()
  /** The cells of runs that have ended, keyed by their retries, for the run list. */
  private readonly settled = new Map<string, { key: string; cells: Cell[] }>()
  /** The timer that keeps running trials' histories while this UI has runs going. */
  private watcher: ReturnType<typeof setInterval> | null = null
  /** Each running trial's daemon, once found. */
  private readonly daemons = new Map<string, string>()

  constructor(root: string) {
    this.root = root
    this.jobsRoot = join(root, 'state', 'harbor')
    this.configDir = join(this.jobsRoot, 'console')
  }

  /** The job configs under `harbor/`: each YAML that lists tasks. */
  async configs(): Promise<Config[]> {
    const dir = join(this.root, 'harbor')
    const out: Config[] = []
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names.filter((n) => n.endsWith('.yaml')).sort()) {
      let doc: any
      try {
        doc = parse(await readFile(join(dir, name), 'utf8'))
      } catch {
        continue
      }
      if (!Array.isArray(doc?.tasks) || !doc.tasks.length) continue
      out.push({
        file: `harbor/${name}`,
        dataset: datasetOf(doc),
        tasks: doc.tasks.map(taskOf),
        paths: doc.tasks.map((t: any) => t.path).filter((p: unknown) => typeof p === 'string'),
        environment: doc.environment?.import_path ?? null,
        verifier: doc.verifier?.import_path ?? null,
      })
    }
    return out
  }

  private dir(id: string): string {
    if (!JOB_ID.test(id) || id.split('/').some((part) => /^\.+$/.test(part))) throw new Error(`Not a job: ${id}`)
    return join(this.jobsRoot, id)
  }

  /** Every job directory under `state/harbor/*`, newest first. */
  async jobs(): Promise<JobBrief[]> {
    const ids = new Set(this.launches.keys())
    for (const jobsDir of await dirs(this.jobsRoot))
      for (const name of await dirs(join(this.jobsRoot, jobsDir)))
        if (existsSync(join(this.jobsRoot, jobsDir, name, 'config.json'))) ids.add(`${jobsDir}/${name}`)
    const out: JobBrief[] = []
    for (const id of ids) {
      const brief = await this.brief(id)
      if (brief) out.push(brief)
    }
    // A job run from a copy of a task (a scratch directory) names no dataset
    // in its path: its task's name does.
    const configs = await this.configs()
    const known = new Set(configs.map((c) => c.dataset))
    const owner = new Map<string, string>()
    for (const c of configs) for (const t of c.tasks) owner.set(t, c.dataset)
    for (const j of out) {
      if (known.has(j.dataset)) continue
      const config = await json(join(this.jobsRoot, j.id, 'config.json'))
      const task = config?.tasks?.[0] ?? config?.datasets?.[0]
      const found = task && owner.get(taskOf(task))
      if (found) j.dataset = found
    }
    // Harbor's counts are the job's own; a job that was retried counts each
    // task's latest attempt, as its cells do.
    const retried = new Set(out.map((j) => j.retryOf))
    for (const j of out) {
      if (!retried.has(j.id)) continue
      const cells = await this.cellsOf(j.id, j.status)
      const ended = cells.filter((c) => c.state === 'succeeded' || c.state === 'failed')
      j.passed = ended.filter((c) => c.state === 'succeeded').length
      j.finished = ended.length
      j.mean = ended.length ? ended.reduce((sum, c) => sum + (c.reward ?? 0), 0) / ended.length : null
    }
    return out.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  }

  private async brief(id: string): Promise<JobBrief | null> {
    const dir = this.dir(id)
    const config = (await json(join(dir, 'config.json'))) ?? (await json(join(this.configDir, `${basename(id)}.json`)))
    if (!config) return null
    const result = await json(join(dir, 'result.json'))
    const lock = config.agents?.length ? null : await json(join(dir, 'lock.json'))
    const stats = result?.stats ?? {}
    const evals = Object.values(stats.evals ?? {}) as any[]
    let passed = 0
    for (const e of evals)
      for (const [value, trials] of Object.entries(e?.reward_stats?.reward ?? {}))
        if (Number(value) >= 1) passed += (trials as string[]).length
    // Harbor's mean, else one from its counts of each reward (a job it
    // never finished writing has the counts and no metric).
    let mean = evals[0]?.metrics?.[0]?.mean
    if (typeof mean !== 'number') {
      let sum = 0
      let n = 0
      for (const e of evals)
        for (const [value, trials] of Object.entries(e?.reward_stats?.reward ?? {})) {
          sum += Number(value) * (trials as string[]).length
          n += (trials as string[]).length
        }
      mean = n ? sum / n : null
    }
    const retry = basename(id).match(RETRY)
    return {
      id,
      name: basename(id),
      dataset: datasetOf(config),
      ...agentOf(config, lock),
      concurrency: config.n_concurrent_trials ?? 4,
      attempts: config.n_attempts ?? 1,
      status: this.statusOf(id, result),
      total: result?.n_total_trials ?? (config.tasks?.length ?? 0) * (config.n_attempts ?? 1),
      finished: stats.n_completed_trials ?? 0,
      running: stats.n_running_trials ?? 0,
      passed,
      errored: stats.n_errored_trials ?? 0,
      mean: typeof mean === 'number' ? mean : null,
      startedAt: result?.started_at ?? (await stat(dir).then((s) => s.birthtime.toISOString(), () => null)),
      retryOf: retry ? id.replace(RETRY, '') : null,
      owned: this.launches.has(id),
    }
  }

  private statusOf(id: string, result: any): JobStatus {
    const launch = this.launches.get(id)
    if (launch) return result ? 'running' : 'starting'
    if (result?.finished_at) return 'done'
    if (this.exited.has(id)) return 'stopped'
    // Started elsewhere, or by a UI since restarted: still running if
    // Harbor has written to it in the last two minutes.
    const updated = Date.parse(result?.updated_at ?? '')
    return Date.now() - updated < 120_000 ? 'running' : 'stopped'
  }

  /** The retries of a job: `<job>__retry-<n>` beside it, oldest first. */
  private async retries(id: string): Promise<string[]> {
    const [jobsDir, name] = id.split('/')
    // A retry just started has no directory yet, only its process.
    const launched = [...this.launches.keys()].filter((k) => k.startsWith(`${jobsDir}/`)).map((k) => basename(k))
    return [...new Set([...(await dirs(join(this.jobsRoot, jobsDir))), ...launched])]
      .filter((n) => n.startsWith(`${name}__retry-`) && RETRY.test(n))
      .sort((a, b) => Number(a.match(RETRY)![1]) - Number(b.match(RETRY)![1]))
      .map((n) => `${jobsDir}/${n}`)
  }

  /** A job's trials, as `[task, trial dir]` in the order they started. */
  private async trials(id: string): Promise<{ task: string; trial: string; started: number }[]> {
    const dir = this.dir(id)
    const out = []
    for (const name of await dirs(dir)) {
      const config = await json(join(dir, name, 'config.json'))
      if (!config?.task) continue
      const started = await stat(join(dir, name)).then((s) => s.birthtimeMs, () => 0)
      out.push({ task: taskOf(config), trial: `${id}/${name}`, started })
    }
    return out.sort((a, b) => a.started - b.started)
  }

  private async cell(task: string, trial: string, attempt: number, commands = true): Promise<Cell> {
    const result = await json(join(this.jobsRoot, trial, 'result.json'))
    const base = { task, trial, attempt, reward: null, error: null, commands: commands ? await this.observed(trial, !result) : [] }
    if (!result) return { ...base, state: 'in-progress' }
    const error = result.exception_info?.exception_type ?? null
    if (error === CANCELLED) return { ...base, state: 'not-started', error }
    const reward = rewardOf(result)
    return { ...base, state: reward !== null && reward >= 1 ? 'succeeded' : 'failed', reward, error }
  }

  async detail(id: string, commands = true): Promise<JobDetail> {
    const dir = this.dir(id)
    const brief = await this.brief(id)
    if (!brief) throw new Error(`No job ${id}`)
    const lock = await json(join(dir, 'lock.json'))
    const config = (await json(join(dir, 'config.json'))) ?? (await json(join(this.configDir, `${brief.name}.json`)))
    // What the job will run: Harbor's lock once it has one, else its config.
    const planned: string[] = lock?.trials
      ? lock.trials.map(taskOf)
      : (config?.tasks ?? []).flatMap((t: any) => Array(config.n_attempts ?? 1).fill(taskOf(t)))
    const started = new Map<string, string[]>()
    for (const t of await this.trials(id)) started.set(t.task, [...(started.get(t.task) ?? []), t.trial])
    const used = new Map<string, number>()
    const cells: Cell[] = []
    for (const task of planned) {
      const i = used.get(task) ?? 0
      used.set(task, i + 1)
      const trial = started.get(task)?.[i]
      cells.push(
        trial
          ? await this.cell(task, trial, 1, commands)
          : { task, trial: null, attempt: 1, state: 'not-started', reward: null, error: null, commands: [] }
      )
    }
    // A retry's trial stands in for the task's first cell, the latest winning.
    for (const [n, retry] of (await this.retries(id)).entries()) {
      for (const t of await this.trials(retry)) {
        const i = cells.findIndex((c) => c.task === t.task)
        if (i >= 0) cells[i] = await this.cell(t.task, t.trial, n + 2, commands)
      }
      const launch = this.launches.get(retry)
      if (launch)
        for (const task of launch.tasks) {
          const i = cells.findIndex((c) => c.task === task)
          if (i >= 0 && cells[i].attempt < n + 2)
            cells[i] = { task, trial: null, attempt: n + 2, state: 'not-started', reward: null, error: null, commands: [] }
        }
    }
    const retrying = (await this.retries(id)).some((r) => this.launches.has(r))
    const launch = this.launches.get(id)
    return {
      ...brief,
      status: retrying && brief.status !== 'running' ? 'running' : brief.status,
      command: launch?.command ?? `harbor run -c ${join('state/harbor', id, 'config.json')}`,
      cells,
      log: launch ? await this.tail(launch.log, 6) : null,
    }
  }

  private async tail(path: string, n: number): Promise<string> {
    const text = await readFile(path, 'utf8').catch(() => '')
    return text.split('\n').filter((l) => l.trim()).slice(-n).join('\n')
  }

  /**
   * A run's cells without their terminals, retries merged in. A run that has
   * ended, with no retry of it running, is read once and kept until another
   * retry of it appears.
   */
  private async cellsOf(id: string, status: JobStatus): Promise<Cell[]> {
    const retries = await this.retries(id)
    const key = retries.join(',')
    const ended = (status === 'done' || status === 'stopped') && !retries.some((r) => this.launches.has(r))
    const hit = this.settled.get(id)
    if (ended && hit?.key === key) return hit.cells
    const cells = (await this.detail(id, false)).cells
    if (ended) this.settled.set(id, { key, cells })
    return cells
  }

  /**
   * The tasks of a dataset's config, each as its directory describes it:
   * `task.toml` and `instruction.md`. Read once per config file version.
   */
  async tasks(dataset: string): Promise<TaskBrief[]> {
    const config = (await this.configs()).find((c) => c.dataset === dataset && c.file === `harbor/${dataset}.yaml`) ??
      (await this.configs()).find((c) => c.dataset === dataset)
    if (!config) throw new Error(`No dataset ${dataset}`)
    const version = await stat(join(this.root, config.file)).then((s) => `${config.file}@${s.mtimeMs}`)
    const hit = this.catalog.get(dataset)
    if (hit?.version === version) return hit.tasks
    const tasks: TaskBrief[] = []
    for (const path of config.paths) tasks.push(await this.taskOf(join(this.root, path)))
    this.catalog.set(dataset, { version, tasks })
    return tasks
  }

  private async taskOf(dir: string): Promise<TaskBrief> {
    const toml = parseToml(await readFile(join(dir, 'task.toml'), 'utf8').catch(() => ''))
    const limits: Record<string, unknown> = {}
    for (const section of ['agent', 'verifier', 'environment'])
      for (const [k, v] of Object.entries(toml[section] ?? {})) limits[`${section}.${k}`] = v
    return {
      task: basename(dir),
      metadata: toml.metadata ?? {},
      limits,
      instruction: await readFile(join(dir, 'instruction.md'), 'utf8').catch(() => ''),
    }
  }

  /**
   * The commands a trial's workspace ran: Mirage's own record of them, its
   * `/.bash_history`, which every session writes to (an agent over SSH
   * too). Read from the trial's daemon while it runs and kept under
   * `state/harbor/console/observed/`, since the daemon goes with the trial;
   * for a trial the UI never watched, the copy a verifier saved.
   */
  private async observed(trial: string, live: boolean): Promise<string[]> {
    const kept = join(this.configDir, 'observed', `${trial}.txt`)
    let text: string | null = null
    if (live) {
      const base = await this.daemon(trial)
      if (base) {
        const get = (path: string, body?: unknown) =>
          fetch(base + path, {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(800),
          }).then((r) => (r.ok ? r.json() : null), () => null)
        const id = await this.workspace(base, get)
        const read = id ? await get(`/v1/workspaces/${id}/vfs/read`, { path: '/.bash_history' }) : null
        if (typeof read === 'string') {
          text = Buffer.from(read, 'base64').toString('utf8')
          await mkdir(dirname(kept), { recursive: true })
          await writeFile(kept, text)
        }
      }
    }
    text ??=
      (await readFile(kept, 'utf8').catch(() => null)) ??
      (await readFile(join(this.jobsRoot, trial, 'verifier', 'bash_history'), 'utf8').catch(() => ''))
    const plan = await json(join(this.jobsRoot, trial, 'mirage', 'plan.json'))
    const setup = (Array.isArray(plan?.run) ? plan.run : []).map((r: any) => String(r?.line ?? r).trim())
    return agentCommands(text, setup)
  }

  /** The trial's workspace on its daemon: Harbor names it `<trial>__env`. */
  private async workspace(base: string, get: (path: string) => Promise<any>): Promise<string | null> {
    const listed = await get('/v1/workspaces')
    const all = (Array.isArray(listed) ? listed : (listed?.workspaces ?? [])) as { id: string }[]
    return (all.find((w) => w.id.endsWith('__env')) ?? all[0])?.id ?? null
  }

  /** Stop one trial: kill its workspace, so the agent's next command fails and the trial ends. */
  async stopTrial(trial: string): Promise<void> {
    if (!/^[\w.-]+\/[\w.-]+\/[\w.-]+$/.test(trial) || trial.split('/').some((p) => /^\.+$/.test(p)))
      throw new Error(`Not a trial: ${trial}`)
    const base = await this.daemon(trial)
    if (!base) throw new Error('The trial is not running')
    const get = (path: string) => fetch(base + path, { signal: AbortSignal.timeout(800) }).then((r) => (r.ok ? r.json() : null), () => null)
    const id = await this.workspace(base, get)
    if (!id) throw new Error('The trial has no workspace')
    const res = await fetch(`${base}/v1/workspaces/${id}/kill`, { method: 'POST', signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`Mirage refused: ${res.status}`)
  }

  /**
   * The trial's Mirage daemon. Claw-Eval's prints its port to daemon.log;
   * Mirage's own leaves only its pid in MIRAGE_HOME, so the port is the one
   * that pid listens on and answers `/v1/health` (the other is its SSH).
   */
  private async daemon(trial: string): Promise<string | null> {
    const known = this.daemons.get(trial)
    if (known) return known
    const dir = join(this.jobsRoot, trial, 'mirage')
    const logged = (await readFile(join(dir, 'daemon.log'), 'utf8').catch(() => '')).match(/HARBOR_SERVER=(\{.*\})/)
    let ports: number[] = logged ? [JSON.parse(logged[1]).port] : []
    if (!ports.length) {
      const pid = (await readFile(join(dir, 'mirage-home', 'daemon.pid'), 'utf8').catch(() => '')).trim()
      if (!/^\d+$/.test(pid)) return null
      const { stdout } = await promisify(execFile)('lsof', ['-nP', '-a', '-p', pid, '-iTCP', '-sTCP:LISTEN', '-Fn'], {
        timeout: 2000,
      }).catch(() => ({ stdout: '' }))
      ports = [...stdout.matchAll(/^n.*:(\d+)$/gm)].map((m) => Number(m[1]))
    }
    for (const port of ports) {
      const base = `http://127.0.0.1:${port}`
      const ok = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok, () => false)
      if (ok) {
        this.daemons.set(trial, base)
        return base
      }
    }
    return null
  }

  private start(id: string, args: string[], tasks: string[]): Launch {
    const log = join(this.configDir, `${basename(id)}.log`)
    const env = existsSync(join(this.root, '.env')) ? ['--env-file', '.env'] : []
    const argv = ['run', '--project', 'harbor', 'harbor', ...args, ...env]
    const fd = openSync(log, 'a')
    // A process group of its own, so Stop reaches Harbor, its fakes and its
    // daemons as Ctrl-C would; and it outlives this server.
    const child = spawn('uv', argv, { cwd: this.root, detached: true, stdio: ['ignore', fd, fd] })
    closeSync(fd)
    const launch: Launch = { child, command: `uv ${argv.join(' ')}`, log, tasks, stopping: false }
    this.launches.set(id, launch)
    this.exited.delete(id)
    const end = () => {
      this.launches.delete(id)
      this.exited.add(id)
    }
    child.on('exit', end)
    child.on('error', end)
    this.watch()
    return launch
  }

  /**
   * Keep every running trial's history of this UI's runs, each second,
   * whether or not a page is open: a trial's daemon goes when the trial
   * ends, and a fast trial can end between two looks at its page.
   */
  private watch() {
    if (this.watcher) return
    let busy = false
    this.watcher = setInterval(async () => {
      if (!this.launches.size) {
        clearInterval(this.watcher!)
        this.watcher = null
        return
      }
      if (busy) return
      busy = true
      try {
        for (const id of this.launches.keys())
          for (const t of await this.trials(id))
            if (!existsSync(join(this.jobsRoot, t.trial, 'result.json'))) await this.observed(t.trial, true)
      } finally {
        busy = false
      }
    }, 1000)
  }

  /** Start a job from a dataset config and the form's choices. */
  async run(request: RunRequest): Promise<string> {
    const source = (await this.configs()).find((c) => c.file === request.config)
    if (!source) throw new Error(`No config ${request.config}`)
    const doc = parse(await readFile(join(this.root, request.config), 'utf8'))
    const keep = globs(request.filter)
    doc.tasks = doc.tasks.filter((t: any) => keep(taskOf(t)))
    if (!doc.tasks.length) throw new Error('No task matches the filter')
    const agent = request.agent.trim()
    if (!agent) throw new Error('Name an agent')
    const model = request.model?.trim()
    doc.agents = [
      {
        ...(agent.includes(':') ? { import_path: agent } : { name: agent }),
        ...(model ? { model_name: model } : {}),
      },
    ]
    doc.n_concurrent_trials = Math.max(1, Math.floor(request.concurrency))
    doc.n_attempts = Math.max(1, Math.floor(request.attempts))
    const short = agent.split(':').pop()!.toLowerCase().replace(/[^\w.-]+/g, '-')
    doc.job_name = `${source.dataset}-${short}-${stamp()}`
    doc.jobs_dir = 'state/harbor/jobs-console'
    await mkdir(this.configDir, { recursive: true })
    const file = join(this.configDir, `${doc.job_name}.json`)
    await writeFile(file, JSON.stringify(doc, null, 2))
    const id = `jobs-console/${doc.job_name}`
    this.start(id, ['run', '-c', `state/harbor/console/${doc.job_name}.json`, '-y'], doc.tasks.map(taskOf))
    return id
  }

  /** Ctrl-C to the job's processes, its retries' too; a second Stop, SIGTERM. */
  async stop(id: string): Promise<void> {
    for (const target of [id, ...(await this.retries(id))]) {
      const launch = this.launches.get(target)
      if (!launch?.child.pid) continue
      const signal = launch.stopping ? 'SIGTERM' : 'SIGINT'
      launch.stopping = true
      try {
        process.kill(-launch.child.pid, signal)
      } catch {}
    }
  }

  /**
   * Delete a run: Harbor's directory for it and its retries', and what the
   * UI kept of them (configs, logs, terminal histories). A run still
   * running is refused; stop it first.
   */
  async remove(id: string): Promise<void> {
    const dir = this.dir(id)
    const targets = [id, ...(await this.retries(id))]
    for (const t of targets) {
      const brief = await this.brief(t)
      if (this.launches.has(t) || brief?.status === 'running' || brief?.status === 'starting')
        throw new Error('The run is still running; stop it first')
    }
    if (!existsSync(dir)) throw new Error(`No run ${id}`)
    // What was deleted and when, since nothing else would say.
    await mkdir(this.configDir, { recursive: true })
    await appendFile(join(this.configDir, 'deleted.log'), `${new Date().toISOString()} ${targets.join(' ')}\n`)
    for (const t of targets) {
      const name = basename(t)
      await rm(join(this.jobsRoot, t), { recursive: true, force: true })
      await rm(join(this.configDir, 'observed', t), { recursive: true, force: true })
      for (const ext of ['.json', '.log']) await rm(join(this.configDir, name + ext), { force: true })
      this.settled.delete(t)
      this.exited.delete(t)
    }
  }

  /** `harbor job resume`: run the trials that never finished, cancelled ones included. */
  async resume(id: string): Promise<void> {
    this.dir(id)
    if (this.launches.has(id)) throw new Error('The job is running')
    this.start(id, ['job', 'resume', '-p', join('state/harbor', id), '-y'], [])
  }

  /**
   * Run some of a job's tasks again, as a job of their own beside it,
   * `<job>__retry-<n>`, with the job's own resolved config. The job's
   * directory is left as Harbor wrote it.
   */
  async retry(id: string, tasks: string[]): Promise<string> {
    const dir = this.dir(id)
    const config = await json(join(dir, 'config.json'))
    if (!config) throw new Error('The job has no config yet')
    const lock = await json(join(dir, 'lock.json'))
    const paths = new Map<string, any>()
    for (const t of [...(config.tasks ?? []), ...(lock?.trials ?? []).map((t: any) => t.task)])
      if (t?.path && !paths.has(taskOf(t))) paths.set(taskOf(t), { path: t.path })
    const chosen = [...new Set(tasks)].filter((t) => paths.has(t))
    if (!chosen.length) throw new Error('None of those tasks is in the job')
    const [jobsDir, name] = id.split('/')
    const n = (await this.retries(id)).length + 1
    const jobName = `${name}__retry-${n}`
    const doc = {
      ...config,
      job_name: jobName,
      jobs_dir: join('state/harbor', jobsDir),
      tasks: chosen.map((t) => paths.get(t)),
      datasets: [],
      n_attempts: 1,
      n_concurrent_trials: Math.min(config.n_concurrent_trials ?? 4, chosen.length),
    }
    await mkdir(this.configDir, { recursive: true })
    await writeFile(join(this.configDir, `${jobName}.json`), JSON.stringify(doc, null, 2))
    const retryId = `${jobsDir}/${jobName}`
    this.start(retryId, ['run', '-c', `state/harbor/console/${jobName}.json`, '-y'], chosen)
    return retryId
  }
}
