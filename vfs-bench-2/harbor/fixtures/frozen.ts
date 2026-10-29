/**
 * A Bun preload that freezes an upstream mock's clocks at `FROZEN_EPOCH`, as
 * `main.ts` and `finance.ts` freeze its seed: `Date` and SQLite's
 * `datetime('now')`. harbor/compare.ts runs upstream's finance mock with it,
 * so its seed's rows and its writes read the epoch the fake's run resets to.
 *
 *     FROZEN_EPOCH=2026-04-03T09:00:00Z bun --preload harbor/fixtures/frozen.ts <mock>
 */
import { Database } from 'bun:sqlite'

const EPOCH = Date.parse(process.env.FROZEN_EPOCH ?? '')
if (Number.isNaN(EPOCH)) throw new Error('set FROZEN_EPOCH to the epoch to freeze at')

const RealDate = Date
class FrozenDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor>) {
    if (args.length === 0) super(EPOCH)
    else super(...args)
  }

  static override now(): number {
    return EPOCH
  }
}
globalThis.Date = FrozenDate as DateConstructor

// Every statement the mock prepares, its `datetime('now')` the epoch's.
const now = `datetime('${new RealDate(EPOCH).toISOString().slice(0, 19).replace('T', ' ')}')`
const freeze = (sql: unknown) => (typeof sql === 'string' ? sql.replace(/datetime\(\s*'now'\s*\)/gi, now) : sql)
const proto = Database.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
for (const name of ['run', 'exec', 'query', 'prepare']) {
  const original = proto[name]!
  proto[name] = function (this: unknown, sql: unknown, ...rest: unknown[]) {
    return original.call(this, freeze(sql), ...rest)
  }
}
