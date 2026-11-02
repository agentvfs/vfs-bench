/** The daemon's clock (clock.ts), in a process of its own, as the preload loads it. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'

const HERE = import.meta.dirname
const EPOCH = Date.parse('2026-04-03T09:00:00Z')

test("a module may set Date.now over the run's clock and put it back", () => {
  // As Mirage's Pyodide worker does for a run: its own clock over the
  // saved one, then the saved one back.
  const script = `
    const day = 86400000
    const near = (ms, at) => Math.abs(ms - at) < 60000
    const saved = Date.now
    const before = [saved(), new Date().getTime(), Date.parse(Date())]
    Date.now = () => saved() + day
    const during = [Date.now(), new Date().getTime(), Date.parse(Date())]
    Date.now = saved
    const after = [Date.now(), new Date().getTime(), Date.parse(Date())]
    console.log(JSON.stringify({
      before: before.every((ms) => near(ms, ${EPOCH})),
      during: during.every((ms) => near(ms, ${EPOCH} + day)),
      after: after.every((ms) => near(ms, ${EPOCH})),
      restored: Date.now === saved,
      built: new Date(0).getTime() === 0,
    }))
  `
  const done = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', '--import', join(HERE, 'clock.ts'), '--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, VFSBENCH_EPOCH: String(EPOCH), VFSBENCH_STARTED: String(Date.now()) } },
  )
  assert.equal(done.status, 0, done.stderr)
  assert.deepEqual(JSON.parse(done.stdout), { before: true, during: true, after: true, restored: true, built: true })
})
