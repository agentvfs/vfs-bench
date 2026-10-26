/**
 * What a dataset hands the harness for one task.
 *
 * A dataset is a directory with an `index.ts` whose `load(slug)` returns a
 * `Task`. The harness owns the order: start the fakes, seed, snapshot, run
 * the agent, snapshot again, grade. A task cannot skip the seed or the
 * grade.
 */
import type { CLI } from '@struktoai/mirage-node'

import type { FakeSpec } from './fakes.ts'
import type { Run } from './runs.ts'

/** A CLI installed on top of workspace.yaml's, such as one generated from a fake's tools. */
export interface InstalledCli {
  name: string
  cli: CLI
  config: Record<string, unknown> | null
}

export interface Check {
  name: string
  passed: boolean
  detail: string
}

export interface Graded {
  passed: boolean
  checks: Check[]
}

export interface GradeInput {
  run: Run
  /** What `snapshot` returned right after the seed. */
  before: unknown
  /** What `snapshot` returned after the agent stopped. */
  after: unknown
  /** What `seed` returned, such as upstream ids mapped to fake ids. */
  seeded: unknown
  /** What the agent submitted with `complete-task`, or null. */
  answer: unknown
}

export interface Task {
  /** The task's directory name under the dataset. */
  slug: string
  /** The task's directory, which holds its workspace.yaml. */
  dir: string
  /** Upstream's instruction, verbatim: the agent's user message. */
  instruction: string
  /** The fakes this task needs, started in order before `seed`. */
  fakes(run: Run): FakeSpec[]
  /** Write the run's files and seed the fakes; returns what `grade` needs. */
  seed(run: Run): Promise<unknown>
  /** CLIs to install once the fakes are up, for tools only a running fake lists. */
  clis?(run: Run): Promise<InstalledCli[]>
  /**
   * Shell lines run in the agent's session before it starts, left out of
   * its history: a function standing in for a command, say.
   */
  shellInit?(run: Run): string[]
  /** The state the grade compares: fake records, files. */
  snapshot(run: Run): Promise<unknown>
  /**
   * Snapshot keys whose values the task's services set from the wall clock
   * when seeding, as LiveClawBench's mocks set `created_at`. Only these may
   * differ between two seeds (`harness/determinism.ts`).
   */
  clockFields?: string[]
  grade(input: GradeInput): Promise<Graded>
  /** Appended to Mirage's system prompt; given the workspace's CLI docs. */
  instructions?(skillMd: string): string
}

/** Graded from checks: passed when every check passed. */
export function graded(checks: Check[]): Graded {
  return { passed: checks.length > 0 && checks.every((c) => c.passed), checks }
}
