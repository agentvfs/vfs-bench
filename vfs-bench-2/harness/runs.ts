/** One run's directory, fakes and the values its workspace.yaml reads. */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Fake } from './fakes.ts'
import { STATE } from './paths.ts'

export const RUNS = join(STATE, 'runs')

/** Everything a run owns, under `state/runs/<id>/`. */
export class Run {
  readonly fakes = new Map<string, Fake>()
  /** `${VAR}` values for workspace.yaml, on top of the process environment. */
  readonly env: Record<string, string> = {}
  readonly id: string
  readonly dir: string

  constructor(id: string, dir: string) {
    this.id = id
    this.dir = dir
  }

  /** A fresh run directory for one task. */
  static create(dataset: string, task: string): Run {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const id = `${stamp}_${dataset}_${task}_${randomBytes(3).toString('hex')}`
    const dir = join(RUNS, id)
    mkdirSync(dir, { recursive: true })
    const run = new Run(id, dir)
    run.env.RUN_DIR = dir
    run.env.ANSWER_PATH = run.answerPath
    // setup/python.py's bundle, which pyodide runtimes load packages from.
    run.env.PYTHON_PACKAGES = join(STATE, 'python')
    return run
  }

  /** Where fixtures for kit fakes are written, one directory per service. */
  get fixtureRoot(): string {
    return join(this.dir, 'fixtures')
  }

  /** Where `complete-task` records the agent's answer. */
  get answerPath(): string {
    return join(this.dir, 'answer.json')
  }

  /** A directory under the run, created on first use. */
  path(...parts: string[]): string {
    const dir = join(this.dir, ...parts)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Stop every fake, last started first. */
  async stop(): Promise<void> {
    for (const fake of [...this.fakes.values()].reverse()) await fake.stop()
  }
}
