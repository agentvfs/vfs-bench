/**
 * Check that a task's seed is deterministic: seed it twice, each time in a
 * fresh run with its own fakes, and compare the two snapshots.
 *
 *     node harness/determinism.ts <dataset>/<task>
 *
 * A snapshot that differs between two seeds would leave graders comparing
 * against state the agent never saw. A service that seeds from the wall
 * clock, as LiveClawBench's mocks do, moves its timestamps by the time
 * between the two seeds and nothing else; those are reported apart, and do
 * not fail the check.
 */
import { type Change, changes } from './diff.ts'
import { loadTask } from './execute.ts'
import { start } from './fakes.ts'
import { Run } from './runs.ts'

/** How far a wall-clock timestamp may stray from the gap between seeds. */
const CLOCK_SLACK_MS = 5000

/** The snapshot right after seeding, in a run of its own, and when the run began. */
async function seeded(ref: string): Promise<{ at: number; snapshot: unknown }> {
  const { dataset, task } = await loadTask(ref)
  const run = Run.create(dataset, task.slug)
  const at = Date.now()
  try {
    for (const spec of task.fakes(run)) await start(spec, run)
    await task.seed(run)
    return { at, snapshot: await task.snapshot(run) }
  } finally {
    await run.stop()
  }
}

/** A timestamp that moved by `gap`, the time between the seeds. */
function followsClock(change: Change, gap: number): boolean {
  if (change.kind !== 'updated' || typeof change.before !== 'string' || typeof change.after !== 'string') return false
  const moved = Date.parse(change.after) - Date.parse(change.before)
  return Number.isFinite(moved) && Math.abs(moved - gap) <= CLOCK_SLACK_MS
}

async function main(): Promise<number> {
  const ref = process.argv[2]
  if (ref === undefined) {
    console.error('usage: node harness/determinism.ts <dataset>/<task>')
    return 2
  }
  const first = await seeded(ref)
  const second = await seeded(ref)
  const diff = changes(first.snapshot, second.snapshot)
  const clock = diff.filter((c) => followsClock(c, second.at - first.at))
  const other = diff.filter((c) => !clock.includes(c))
  for (const change of other) {
    console.log(`${change.kind} ${change.path.join('.')}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`.slice(0, 400))
  }
  const note = clock.length === 0 ? '' : `; ${clock.length} timestamp(s) follow the wall clock`
  console.log(`${other.length === 0 ? 'SAME' : 'DIFFERENT'}  ${ref}: ${other.length} change(s) between two seeds${note}`)
  return other.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(await main())
