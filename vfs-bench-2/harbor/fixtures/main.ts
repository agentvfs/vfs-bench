/**
 * A task's kit fixture, from upstream's own seed: run under Bun, since the
 * seeds are bun:sqlite code.
 *
 *     TZ=UTC bun harbor/fixtures/main.ts <task> <service> <epoch>
 *
 * Upstream's mock seeds its database for `TASK_NAME` when it starts, its
 * times relative to `new Date()` and its file names from
 * `crypto.randomUUID()`. Here the seed runs as it is into a scratch SQLite,
 * with the clock frozen at the epoch the task's runs reset to and the UUIDs
 * counted, and the rows it wrote become the fixture the kit fake seeds each
 * run from, printed as JSON. `harbor/export.py` writes it to the task's
 * `environment/fixtures/<service>.json`.
 */
import { join, resolve } from 'node:path'

const [task, service, epoch] = process.argv.slice(2)
if (task === undefined || service === undefined || epoch === undefined) {
  throw new Error('usage: bun harbor/fixtures/main.ts <task> <service> <epoch>')
}
const EPOCH = Date.parse(epoch)
if (Number.isNaN(EPOCH)) throw new Error(`epoch ${epoch} is not a date`)
if (new Date(0).getTimezoneOffset() !== 0) throw new Error('run with TZ=UTC: upstream seeds dates in local time')

/** Upstream's mock-platform, in the checkout `liveclawbench/setup.py` downloads. */
export const PLATFORM = resolve(import.meta.dir, '..', '..', 'state', 'liveclawbench', 'src', 'mock-platform')

// Frozen before any of upstream's modules load, so their own `new Date()`
// and `Date.now()` read the epoch.
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
let uuids = 0
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `5eed0000-0000-4000-8000-${String(++uuids).padStart(12, '0')}`,
})
process.env.TASK_NAME = task

const converters: Record<string, () => Promise<unknown>> = {
  chat: async () => (await import('./chat.ts')).chat(join(PLATFORM, 'mocks', 'chat')),
  weather: async () => (await import('./weather.ts')).weather(join(PLATFORM, 'mocks', 'weather')),
  gws: async () => (await import('./gws.ts')).gws(join(PLATFORM, 'mocks', 'email'), task),
  finance: async () => (await import('./finance.ts')).finance(join(PLATFORM, 'mocks', 'finance'), join(PLATFORM, '..', 'tasks', task), epoch),
}
const convert = converters[service]
if (convert === undefined) throw new Error(`no fixture converter for ${service}`)
process.stdout.write(`${JSON.stringify(await convert(), null, 1)}\n`)
