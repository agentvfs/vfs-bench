/**
 * What upstream's mock reads from its process, here from the request
 * (app.ts injects these into its bundle in place of the globals):
 *
 * - `Date`: `new Date()` and `Date.now()` are the request's time, as
 *   harbor/fixtures/main.ts freezes them for the seed; a date given its
 *   value is the date it names.
 * - `process.env.TASK_NAME`: the run's, which its fixture states.
 */
import { request } from './sqlite.ts'

const RealDate = globalThis.Date

/** The request's time, or the real one outside a request (the bundle's own setup). */
function now(): number {
  try {
    return request().nowMs
  } catch {
    return RealDate.now()
  }
}

class FrozenDate extends RealDate {
  // Any of Date's forms; the arguments go to it as they came.
  constructor(...args: unknown[]) {
    if (args.length === 0) super(now())
    else super(...(args as [number, number]))
  }

  static override now(): number {
    return now()
  }
}

export { FrozenDate as Date }

/** `process.env.TASK_NAME`, by request. */
export const __vfsbenchEnv = {
  get TASK_NAME(): string {
    return request().taskName
  },
}
