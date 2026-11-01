/**
 * The trial's clock in its daemon, loaded by preload.ts before anything
 * else: the run's epoch when the trial started, moving on in real time.
 *
 *     VFSBENCH_EPOCH=<ms> VFSBENCH_STARTED=<ms>
 *
 * A task's services are frozen at its epoch (workspace.yaml's `epoch`), as its
 * fixture was seeded. Without this the workspace would read the host's
 * date: `date`, file times and Python's `time` and `datetime` (Pyodide reads
 * `Date.now()` in its worker, below). `Date` with no arguments, called or
 * constructed, and `Date.now()` are shifted by the same offset in every
 * thread; a date built from a value is left as it is.
 *
 * Mirage starts Pyodide's worker with execArgv of its own, which drops the
 * daemon's `--import`, so every worker the daemon starts gets this module
 * as an `--import` too: `Worker` is wrapped, and `syncBuiltinESMExports`
 * makes `import { Worker } from 'node:worker_threads'` see the wrapper.
 * The workspace's own clock is its `system_time`, which the environment
 * sends; this covers what in Mirage still reads the host's clock: the days
 * `/gcal` and `/discord` list, and curl's cookie expiry.
 */
import module from 'node:module'
import workers from 'node:worker_threads'

const epoch = Number(process.env.VFSBENCH_EPOCH)
const started = Number(process.env.VFSBENCH_STARTED)
if (Number.isFinite(epoch) && Number.isFinite(started)) {
  const RealDate = Date
  const realNow = RealDate.now.bind(RealDate)
  const shift = epoch - started
  const now = () => realNow() + shift
  // What `Date.now` is: this, or what a module assigns over it (Mirage's
  // Pyodide worker does, for the run), until it puts this back.
  let current = now
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length === 0 ? [current()] : args, newTarget),
    apply: () => new RealDate(current()).toString(),
    get: (target, key, receiver) => (key === 'now' ? current : Reflect.get(target, key, receiver)),
    set: (target, key, value, receiver) => {
      if (key !== 'now') return Reflect.set(target, key, value, receiver)
      current = value as () => number
      return true
    },
  })
  if (workers.isMainThread) {
    const Worker = workers.Worker
    const self = import.meta.url
    workers.Worker = class extends Worker {
      constructor(file: string | URL, options: workers.WorkerOptions = {}) {
        super(file, { ...options, execArgv: [...(options.execArgv ?? process.execArgv), '--import', self] })
      }
    } as typeof Worker
    module.syncBuiltinESMExports()
  }
}
