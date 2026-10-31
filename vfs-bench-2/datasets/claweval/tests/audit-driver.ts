/**
 * The port's side of audit.py: each stdin line a case and the reference's
 * judge tape, each stdout line the port's grade of it over that tape.
 */
import { createInterface } from 'node:readline'
import { grade, replay } from '../graders/grade.ts'
import { BaseException, fromJSON } from '../graders/py.ts'

for await (const line of createInterface({ input: process.stdin })) {
  if (!line) continue
  const { id, case: c, tape } = JSON.parse(line)
  let out: unknown
  try {
    const result = await grade(
      {
        task: c.task,
        model: c.model,
        audit: c.audit,
        run: { trajectory: c.trajectory, dispatches: c.dispatches, seed: c.seed, gws: fromJSON(c.gws), epoch: c.epoch },
      },
      replay(tape),
      undefined,
      false
    )
    out = { id, ...result }
  } catch (error) {
    // As the reference prints it: `type(exc).__name__: str(exc)`.
    const text =
      error instanceof BaseException
        ? `${error.name.replace(/_$/, '')}: ${error}`
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
    out = { id, error: text, stack: (error as Error)?.stack }
  }
  process.stdout.write(JSON.stringify(out) + '\n')
}
