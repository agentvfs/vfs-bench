/**
 * `pnpm test`: a task's COPY lines, as both adapters read them and mocks.ts
 * lays them out. The upstream-directory cases need LiveClawBench's checkout
 * (`liveclawbench/setup.py`) and are skipped without it.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Run } from '../harness/runs.ts'
import { PLATFORM } from '../liveclawbench/index.ts'
import { copiedPath, copyInto } from './copies.ts'
import * as liveclawbench from './liveclawbench.ts'
import * as mirage from './mirage.ts'

const CHECKOUT = existsSync(join(PLATFORM, 'config', 'task-binary-map.json'))

/** A task directory with `environment/` holding policies/, notes/ and seed.sql, and the given files. */
function taskDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-copies-'))
  const env = join(dir, 'environment')
  mkdirSync(join(env, 'policies'), { recursive: true })
  mkdirSync(join(env, 'notes'), { recursive: true })
  writeFileSync(join(env, 'policies', 'policy.md'), 'policy\n')
  writeFileSync(join(env, 'notes', 'note.md'), 'note\n')
  writeFileSync(join(env, 'notes', 'shared.md'), 'from notes\n')
  writeFileSync(join(env, 'policies', 'shared.md'), 'from policies\n')
  writeFileSync(join(env, 'seed.sql'), '-- seed\n')
  for (const [path, text] of Object.entries(files)) writeFileSync(join(env, path), text)
  return dir
}

/** The copies laid out under a scratch `/workspace`, there first as the workspace makes it, and what each file there holds. */
function laid(copies: Parameters<typeof copyInto>[0]): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'vfsbench-copies-ws-'))
  mkdirSync(join(root, 'workspace'))
  try {
    copyInto(copies, (path) => (path === '/workspace' || path.startsWith('/workspace/') ? join(root, path.slice(1)) : undefined), 'test')
    const out: Record<string, string> = {}
    for (const name of ['policy.md', 'note.md', 'shared.md', 'seed.sql']) {
      const file = join(root, 'workspace', name)
      if (existsSync(file)) out[name] = readFileSync(file, 'utf8')
    }
    return out
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('two directory COPYs to one destination both arrive, the later file winning', { skip: !CHECKOUT }, () => {
  const dir = taskDir({
    Dockerfile: [
      'FROM liveclawbench-finance-expense-log-base:latest',
      'ENV MOCK_FINANCE_DB_PATH=/opt/mock/data/finance_app.sqlite',
      'COPY policies/ /workspace/',
      'COPY notes/ /workspace/',
      '',
    ].join('\n'),
  })
  try {
    const plan = liveclawbench.plan(dir, new Run('copies-test', join(dir, 'run')))
    assert.deepEqual(
      plan.copies.map((c) => c.to),
      ['/workspace', '/workspace'],
    )
    assert.deepEqual(laid(plan.copies), { 'policy.md': 'policy\n', 'note.md': 'note\n', 'shared.md': 'from notes\n' })
    assert.equal(copiedPath(plan.copies, '/workspace/shared.md'), join(dir, 'environment', 'notes', 'shared.md'))
    assert.equal(copiedPath(plan.copies, '/workspace/policy.md'), join(dir, 'environment', 'policies', 'policy.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an ENV naming a file COPY put at that exact path is the host's file for the mock", { skip: !CHECKOUT }, () => {
  const dir = taskDir({
    Dockerfile: [
      'FROM liveclawbench-finance-expense-log-base:latest',
      'ENV MOCK_FINANCE_DB_PATH=/opt/mock/data/finance_app.sqlite',
      'ENV MOCK_FINANCE_SEED_SQL=/workspace/seed.sql',
      'COPY seed.sql /workspace/seed.sql',
      '',
    ].join('\n'),
  })
  try {
    const plan = liveclawbench.plan(dir, new Run('copies-test', join(dir, 'run')))
    assert.equal(plan.fakes[0]!.env!.MOCK_FINANCE_SEED_SQL, join(dir, 'environment', 'seed.sql'))
    // The workspace still sees the path the container does.
    assert.equal(plan.env.MOCK_FINANCE_SEED_SQL, '/workspace/seed.sql')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an upstream finance task's seed SQL under COPY . reaches its mock as the host's file", { skip: !CHECKOUT }, () => {
  const task = join(PLATFORM, '..', 'tasks', 'finance-anomaly-detect')
  const run = mkdtempSync(join(tmpdir(), 'vfsbench-copies-run-'))
  try {
    const plan = liveclawbench.plan(task, new Run('copies-test', run))
    assert.equal(plan.fakes[0]!.env!.MOCK_FINANCE_SEED_SQL, join(task, 'environment', 'seed.sql'))
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
})

test("mirage.yaml's several COPYs to one destination arrive in order", () => {
  const dir = taskDir({
    'mirage.yaml': [
      'fakes: {}',
      'copy:',
      '  /workspace:',
      '    - {src: policies/}',
      '    - {src: notes/}',
      '    - {src: ., entries: [seed.sql]}',
      '',
    ].join('\n'),
  })
  try {
    const plan = mirage.plan(dir, new Run('copies-test', join(dir, 'run')), {})
    assert.deepEqual(
      plan.copies.map((c) => c.to),
      ['/workspace', '/workspace', '/workspace/seed.sql'],
    )
    assert.deepEqual(laid(plan.copies), { 'policy.md': 'policy\n', 'note.md': 'note\n', 'shared.md': 'from notes\n', 'seed.sql': '-- seed\n' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file COPY onto a directory that is there goes inside it, and an ENV naming it is the host file', () => {
  const dir = taskDir({})
  try {
    const seed = join(dir, 'environment', 'seed.sql')
    const copies = [{ to: '/workspace', from: seed }]
    assert.deepEqual(laid(copies), { 'seed.sql': '-- seed\n' })
    assert.equal(copiedPath(copies, '/workspace/seed.sql'), seed)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
