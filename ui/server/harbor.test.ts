import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { localHost } from './api.ts'
import { agentLines, globs, Harbor, parseToml } from './harbor.ts'

async function put(path: string, value: unknown) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

/** A job as Harbor leaves it: four tasks, three trials, one retry. */
async function job(root: string) {
  const dir = join(root, 'state/harbor/jobs/j1')
  const task = (name: string) => ({ path: `datasets/demo/${name}/harbor` })
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

test('a box shows what the agent ran, with its output, not what Harbor ran around it', () => {
  // Mirage's history: a command entry per line, a result entry naming it.
  const lines = [
    'mkdir -p /workspace/output',
    'chmod +x /solution/solve.sh',
    'export DEBIAN_FRONTEND=noninteractive\nset -e\nlight-system now',
    'test -d /logs/artifacts',
    'light-talk get-myuid',
    'rm -f -- /logs/verifier/reward.txt /logs/verifier/reward.json',
    'chmod +x /tests/test.sh',
  ]
  const history = lines.flatMap((command, i) => [
    { type: 'command', session: 'default', timestamp: 1000 + i, id: `l${i}`, command },
    { type: 'result', session: 'default', timestamp: 1001 + i, parent: `l${i}`, exit_code: i === 4 ? 1 : 0, stdout: i === 4 ? 'user_1\n' : '', stderr: i === 4 ? 'slow\n' : '', duration_ms: 5 },
  ])
  history.push({ type: 'command', session: 'default', timestamp: 2000, id: 'l9', command: 'light-shop get-cart-summary' } as any)
  const seen = agentLines(history.slice(0, 10).concat(history.slice(-1)))
  assert.deepEqual(seen.map((l) => l.command), ['mkdir -p /workspace/output', 'set -e\nlight-system now', 'light-talk get-myuid', 'light-shop get-cart-summary'])
  assert.deepEqual(seen[2], { command: 'light-talk get-myuid', stdout: 'user_1\n', stderr: 'slow\n', exit: 1, at: 1004, ms: 5 })
  // Still running: no result yet.
  assert.deepEqual([seen[3].exit, seen[3].ms, seen[3].stdout], [null, null, ''])
  assert.deepEqual(agentLines(history, ['mkdir -p /workspace/output']).map((l) => l.command), ['set -e\nlight-system now', 'light-talk get-myuid'])
  // A line of comments only shows nothing; a heredoc's `#` lines are its body.
  const commented = ['#!/usr/bin/env bash', '# note\n\n# more', 'cat <<A\n# body\nA\n'].map((command, i) => ({ type: 'command', id: `c${i}`, command }))
  assert.deepEqual(agentLines(commented).map((l) => l.command), ['cat <<A\n# body\nA'])
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
  const task = { path: 'datasets/demo/a/harbor' }
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
  await put(join(root, 'state/harbor/console/jobs/k2__retry-1.picks.json'), [{ task: 'a', slot: 1 }])
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
  assert.ok(existsSync(join(root, 'state/harbor/console/jobs/j1.log')))
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

test("stopping a trial kills it on the job's daemon that holds it", async () => {
  const kills: string[] = []
  const daemon = (id: string) =>
    createServer((req, res) => {
      if (req.method === 'POST') kills.push(req.url ?? '')
      res.setHeader('content-type', 'application/json')
      res.end(req.url === '/v1/workspaces' ? JSON.stringify([{ id }]) : '{}')
    })
  const [other, mine] = [daemon('u__1__env'), daemon('t__1__env')]
  for (const d of [other, mine]) await new Promise<void>((r) => d.listen(0, '127.0.0.1', r))
  const port = (d: typeof other) => (d.address() as AddressInfo).port
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await mkdir(join(root, 'state/harbor/jobs/j/t__1/mirage'), { recursive: true })
  for (const d of [other, mine]) await mkdir(join(root, `state/harbor/jobs/j/mirage-daemon-${port(d)}`))
  try {
    await new Harbor(root).stopTrial('jobs/j/t__1')
    assert.deepEqual(kills, ['/v1/workspaces/t__1__env/kill'])
  } finally {
    other.close()
    mine.close()
  }
})

test("the form's 0 workers gives each trial a daemon, over the config's", async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await mkdir(join(root, 'datasets/demo/harbor'), { recursive: true })
  await writeFile(
    join(root, 'datasets/demo/harbor/job.yaml'),
    'environment:\n  kwargs:\n    workers: 4\n    seed: 1\ntasks:\n  - path: datasets/demo/a/harbor\n',
  )
  const harbor = new Harbor(root)
  const run = (workers: number) =>
    harbor.run({ config: 'datasets/demo/harbor/job.yaml', agent: 'oracle', concurrency: 1, attempts: 1, workers })
  const kwargs = async (id: string) => JSON.parse(await readFile(join(root, 'state/harbor/console', `${id}.json`), 'utf8')).environment.kwargs
  assert.deepEqual(await kwargs(await run(0)), { seed: 1 })
  assert.deepEqual(await kwargs(await run(2)), { seed: 1, workers: 2 })
  // uv finds no harbor project here and exits; wait for it.
  for (let i = 0; i < 100 && harbor.busy; i++) await new Promise((r) => setTimeout(r, 100))
})

test('only this machine by name may reach the server', () => {
  assert.ok(localHost('localhost:8787'))
  assert.ok(localHost('127.0.0.1:5174'))
  assert.ok(localHost('[::1]:8787'))
  assert.ok(!localHost('evil.example:8787'))
  assert.ok(!localHost(undefined))
})

test('a new retry numbers above every retry there is', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await job(root)
  // retry-1 was deleted; retry-2 is still there. Filling the gap would
  // give retry-1, which retry-2 would then hide.
  await rm(join(root, 'state/harbor/jobs/j1__retry-1'), { recursive: true })
  await put(join(root, 'state/harbor/jobs/j1__retry-2/config.json'), { tasks: [] })
  const harbor = new Harbor(root)
  const id = await harbor.retry('jobs/j1', [{ task: 'b', slot: 0 }])
  assert.equal(id, 'jobs/j1__retry-3')
  assert.ok(existsSync(join(root, 'state/harbor/console/jobs/j1__retry-3.picks.json')))
  for (let i = 0; i < 100 && harbor.busy; i++) await new Promise((r) => setTimeout(r, 100))
})

test('jobs of one name in two jobs folders keep their own retry files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  const task = { path: 'datasets/demo/a/harbor' }
  for (const folder of ['jobs', 'reference']) {
    const dir = join(root, `state/harbor/${folder}/baseline`)
    await put(join(dir, 'config.json'), { n_attempts: 2, tasks: [task] })
    await put(join(dir, 'lock.json'), { trials: [{ task }, { task }] })
    await put(join(dir, 'result.json'), { finished_at: '2026-10-30T00:01:00', stats: {} })
  }
  const harbor = new Harbor(root)
  await harbor.retry('jobs/baseline', [{ task: 'a', slot: 0 }])
  await harbor.retry('reference/baseline', [{ task: 'a', slot: 1 }])
  const picks = (folder: string) =>
    readFile(join(root, `state/harbor/console/${folder}/baseline__retry-1.picks.json`), 'utf8').then(JSON.parse)
  assert.deepEqual(await picks('jobs'), [{ task: 'a', slot: 0 }])
  assert.deepEqual(await picks('reference'), [{ task: 'a', slot: 1 }])
  for (let i = 0; i < 100 && harbor.busy; i++) await new Promise((r) => setTimeout(r, 100))
})

test('a retry from before picks were kept by full id still redoes its attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  const dir = join(root, 'state/harbor/jobs/old')
  const task = { path: 'datasets/demo/a/harbor' }
  await put(join(dir, 'config.json'), { n_attempts: 2, tasks: [task] })
  await put(join(dir, 'lock.json'), { trials: [{ task }, { task }] })
  await put(join(dir, 'result.json'), { finished_at: '2026-10-30T00:01:00', stats: {} })
  const retry = join(root, 'state/harbor/jobs/old__retry-1')
  await put(join(retry, 'config.json'), { tasks: [task] })
  await put(join(retry, 'a__3/config.json'), { task })
  await put(join(retry, 'a__3/result.json'), { verifier_result: { rewards: { reward: 1 } } })
  await put(join(root, 'state/harbor/console/old__retry-1.picks.json'), [{ task: 'a', slot: 1 }])
  const cells = (await new Harbor(root).detail('jobs/old', false)).cells
  assert.deepEqual(cells.map((c) => [c.slot, c.attempt]), [[0, 1], [1, 2]])
})

test("each dataset's job configs, their tasks named by the directory above harbor/", async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-'))
  await mkdir(join(root, 'datasets/demo/harbor'), { recursive: true })
  await writeFile(
    join(root, 'datasets/demo/harbor/job.yaml'),
    'tasks:\n  - path: datasets/demo/a/harbor\n  - path: datasets/demo/b/harbor\n',
  )
  const [config] = await new Harbor(root).configs()
  assert.equal(config?.file, 'datasets/demo/harbor/job.yaml')
  assert.equal(config?.dataset, 'demo')
  assert.deepEqual(config?.tasks, ['a', 'b'])
})
