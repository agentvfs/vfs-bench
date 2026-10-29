/**
 * Check that a task's seed is deterministic: seed it twice, each time in a
 * fresh run with its own fakes, and compare the two snapshots.
 *
 *     node harness/determinism.ts <dataset>/<task>
 *
 * A snapshot that differs between two seeds would leave graders comparing
 * against state the agent never saw. A service that seeds from the wall
 * clock, as LiveClawBench's mocks do, moves its timestamps by the time
 * between the two seeds and nothing else. A task declares those fields
 * (`Task.clockFields`); a declared field that moved that way is reported
 * apart, and does not fail the check.
 */
import { type Change, changes } from './diff.ts'
import { loadTask } from './execute.ts'
import { start } from './fakes.ts'
import { Run } from './runs.ts'

/** How far a wall-clock timestamp may stray from the gap between seeds. */
const CLOCK_SLACK_MS = 5000

/**
 * The snapshot right after seeding, in a run of its own; when the run
 * began; and the task's wall-clock fields.
 */
async function seeded(ref: string): Promise<{ at: number; snapshot: unknown; clockFields: string[] }> {
  const { dataset, task } = await loadTask(ref)
  const run = Run.create(dataset, task.slug)
  const at = Date.now()
  try {
    for (const spec of task.fakes(run)) await start(spec, run)
    await task.seed(run)
    return { at, snapshot: await task.snapshot(run), clockFields: task.clockFields ?? [] }
  } finally {
    await run.stop()
  }
}

/** A date and a time, with an optional fraction and zone: `2026-10-25 09:42:06`, `2026-10-25T09:42:06.5Z`. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/

/**
 * A declared wall-clock field whose timestamp moved forward by `gap`, the
 * time between the seeds, and kept its format: anything else is a real
 * difference. A timestamp is a date-time string, or an integer of epoch
 * milliseconds (as Gmail's `internal_date`).
 */
function followsClock(change: Change, gap: number, clockFields: string[]): boolean {
  const { kind, path, before, after } = change
  if (kind !== 'updated' || !clockFields.includes(path.at(-1) ?? '')) return false
  let moved: number
  if (Number.isInteger(before) && Number.isInteger(after)) moved = (after as number) - (before as number)
  else if (typeof before !== 'string' || typeof after !== 'string') return false
  else if (!TIMESTAMP.test(before) || before.replace(/\d/g, '0') !== after.replace(/\d/g, '0')) return false
  else moved = Date.parse(after) - Date.parse(before)
  return moved > 0 && Math.abs(moved - gap) <= CLOCK_SLACK_MS
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
  const clock = diff.filter((c) => followsClock(c, second.at - first.at, first.clockFields))
  const other = diff.filter((c) => !clock.includes(c))
  for (const change of other) {
    console.log(`${change.kind} ${change.path.join('.')}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`.slice(0, 400))
  }
  const note = clock.length === 0 ? '' : `; ${clock.length} timestamp(s) follow the wall clock`
  console.log(`${other.length === 0 ? 'SAME' : 'DIFFERENT'}  ${ref}: ${other.length} change(s) between two seeds${note}`)
  return other.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(await main())
