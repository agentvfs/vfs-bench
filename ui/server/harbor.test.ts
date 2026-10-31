import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { localHost } from './api.ts'
import { agentCommands, globs, Harbor, parseToml } from './harbor.ts'

async function put(path: string, value: unknown) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

/** A job as Harbor leaves it: four tasks, three trials, one retry. */
async function job(root: string) {
  const dir = join(root, 'state/harbor/jobs/j1')
  const task = (name: string) => ({ path: `harbor/tasks/demo/${name}` })
  await put(join(dir, 'config.json'), { n_concurrent_trials: 2, agents: [{ name: 'oracle' }], tasks: ['a', 'b', 'c', 'd'].map(task) })
  await put(join(dir, 'lock.json'), { trials: ['a', 'b', 'c', 'd'].map((t) => ({ task: task(t) })) })
  await put(join(dir, 'result.json'), { started_at: '2026-10-30T00:00:00', finished_at: '2026-10-30T00:01:00', n_total_trials: 4, stats: {} })
  await put(join(dir, 'a__1/config.json'), { task: task('a') })
  await put(join(dir, 'a__1/result.json'), { verifier_result: { rewards: { reward: 1 } } })
  await put(join(dir, 'b__1/config.json'), { task: task('b') })
  await put(join(dir, 'b__1/result.json'), { verifier_result: { rewards: { reward: 0.5 } } })
  await put(join(dir, 'c__1/config.json'), { task: task('c') })
  await put(join(dir, 'c__1/result.json'), { exception_info: { exception_type: 'CancelledError' } })
  const retry = join(root, 'state/harbor/jobs/j1__retry-1')
  await put(join(retry, 'config.json'), { tasks: [task('b')] })
  await put(join(retry, 'b__2/config.json'), { task: task('b') })
}

test('cells follow trials, cancelled is not started, a retry stands in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await job(root)
  const harbor = new Harbor(root)
  const detail = await harbor.detail('jobs/j1')
  assert.deepEqual(
    detail.cells.map((c) => [c.task, c.state, c.attempt]),
    [
      ['a', 'succeeded', 1],
      ['b', 'in-progress', 2],
      ['c', 'not-started', 1],
      ['d', 'not-started', 1],
    ]
  )
  assert.equal(detail.status, 'done')
  const retryOf = new Map((await harbor.jobs()).map((j) => [j.id, j.retryOf]))
  assert.deepEqual([...retryOf].sort(), [['jobs/j1', null], ['jobs/j1__retry-1', 'jobs/j1']])
})

test('a reward below 1 fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await job(root)
  await writeFile(join(root, 'state/harbor/jobs/j1__retry-1/b__2/result.json'), JSON.stringify({ verifier_result: { rewards: { reward: 0.5 } } }))
  const cell = (await new Harbor(root).detail('jobs/j1')).cells[1]
  assert.deepEqual([cell.state, cell.reward], ['failed', 0.5])
})

test('globs match as -i does', () => {
  const keep = globs('finance-* search-01?')
  assert.ok(keep('finance-budget'))
  assert.ok(keep('search-012'))
  assert.ok(!keep('search-0123'))
  assert.ok(globs('')('anything'))
})

test('job ids cannot leave state/harbor', async () => {
  const harbor = new Harbor(await mkdtemp(join(tmpdir(), 'ui-')))
  await assert.rejects(harbor.detail('../etc'), /Not a job/)
  await assert.rejects(harbor.detail('jobs/../../x'), /Not a job/)
})

test('a box shows what the agent ran, not what Harbor ran around it', () => {
  const histfile = [
    '#1793405650', 'mkdir -p /workspace/output',
    '#1793405650', 'chmod +x /solution/solve.sh',
    '#1793405651', 'export DEBIAN_FRONTEND=noninteractive', '(/solution/solve.sh) > /logs/agent/oracle.txt 2>&1',
    '#1793405651', 'test -d /logs/artifacts',
    '#1793405651', 'rm -f -- /logs/verifier/reward.txt /logs/verifier/reward.json',
    '#1793405651', 'chmod +x /tests/test.sh',
    '#1793405651', '(/tests/test.sh) > /logs/verifier/test-stdout.txt 2>&1',
  ].join('\n')
  assert.deepEqual(agentCommands(histfile), ['mkdir -p /workspace/output', '/solution/solve.sh'])
  assert.deepEqual(agentCommands(histfile, ['mkdir -p /workspace/output']), ['/solution/solve.sh'])
})

test('delete takes a run, its retries and nothing else', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await job(root)
  await put(join(root, 'state/harbor/jobs/j2/config.json'), { tasks: [] })
  const harbor = new Harbor(root)
  await harbor.remove('jobs/j1')
  assert.deepEqual((await harbor.jobs()).map((j) => j.id), ['jobs/j2'])
  await assert.rejects(harbor.remove('jobs/../../etc'), /Not a job/)
})

test('task.toml reads as its sections', () => {
  const toml = parseToml(['version = "1.0"', '', '[metadata]', 'category = "finance"  # a note', 'tags = ["a", "b"]', 'level = 1', '', '[environment]', 'allow_internet = false'].join('\n'))
  assert.deepEqual(toml.metadata, { category: 'finance', tags: ['a', 'b'], level: 1 })
  assert.deepEqual(toml.environment, { allow_internet: false })
})

test('a retry stands in for the attempt it was asked to redo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  const dir = join(root, 'state/harbor/jobs/k2')
  const task = { path: 'harbor/tasks/demo/a' }
  await put(join(dir, 'config.json'), { n_attempts: 2, tasks: [task] })
  await put(join(dir, 'lock.json'), { trials: [{ task }, { task }] })
  await put(join(dir, 'result.json'), { finished_at: '2026-10-30T00:01:00', stats: {} })
  await put(join(dir, 'a__1/config.json'), { task })
  await put(join(dir, 'a__1/result.json'), { verifier_result: { rewards: { reward: 1 } } })
  await new Promise((r) => setTimeout(r, 20))
  await put(join(dir, 'a__2/config.json'), { task })
  await put(join(dir, 'a__2/result.json'), { verifier_result: { rewards: { reward: 0 } } })
  const retry = join(root, 'state/harbor/jobs/k2__retry-1')
  await put(join(retry, 'config.json'), { tasks: [task] })
  await put(join(retry, 'a__3/config.json'), { task })
  await put(join(retry, 'a__3/result.json'), { verifier_result: { rewards: { reward: 1 } } })
  await put(join(root, 'state/harbor/console/k2__retry-1.picks.json'), [{ task: 'a', slot: 1 }])
  const cells = (await new Harbor(root).detail('jobs/k2', false)).cells
  assert.deepEqual(cells.map((c) => [c.slot, c.state, c.attempt]), [
    [0, 'succeeded', 1],
    [1, 'succeeded', 2],
  ])
})

test('resume works on a runs folder this UI never used', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await job(root)
  const harbor = new Harbor(root)
  await harbor.resume('jobs/j1')
  assert.ok(existsSync(join(root, 'state/harbor/console/j1.log')))
  // uv finds no harbor project here and exits; wait for it.
  for (let i = 0; i < 100 && harbor.busy; i++) await new Promise((r) => setTimeout(r, 100))
})

test('stopping a trial leaves a daemon that is not serving it alone', async () => {
  const kills: string[] = []
  const daemon = createServer((req, res) => {
    if (req.method === 'POST') kills.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(req.url === '/v1/workspaces' ? JSON.stringify([{ id: 'another__env' }]) : '{}')
  })
  await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r))
  const port = (daemon.address() as AddressInfo).port
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await mkdir(join(root, 'state/harbor/jobs/j/t__1/mirage'), { recursive: true })
  await writeFile(join(root, 'state/harbor/jobs/j/t__1/mirage/daemon.log'), `HARBOR_SERVER=${JSON.stringify({ port })}\n`)
  try {
    await assert.rejects(new Harbor(root).stopTrial('jobs/j/t__1'), /not running/)
    assert.deepEqual(kills, [])
  } finally {
    daemon.close()
  }
})

test('only this machine by name may reach the server', () => {
  assert.ok(localHost('localhost:8787'))
  assert.ok(localHost('127.0.0.1:5174'))
  assert.ok(localHost('[::1]:8787'))
  assert.ok(!localHost('evil.example:8787'))
  assert.ok(!localHost(undefined))
})
