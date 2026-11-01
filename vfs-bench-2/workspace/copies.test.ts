/**
 * `pnpm test`: a task's `copy` entries, as mirage.ts reads and lays them out.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { copiedPath, copyInto } from './copies.ts'
import * as mirage from './mirage.ts'

/** A task's `workspace/`, its files/ holding policies/, notes/ and seed.sql, and the given files. */
function workspaceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-copies-'))
  const env = join(dir, 'files')
  mkdirSync(join(env, 'policies'), { recursive: true })
  mkdirSync(join(env, 'notes'), { recursive: true })
  writeFileSync(join(env, 'policies', 'policy.md'), 'policy\n')
  writeFileSync(join(env, 'notes', 'note.md'), 'note\n')
  writeFileSync(join(env, 'notes', 'shared.md'), 'from notes\n')
  writeFileSync(join(env, 'policies', 'shared.md'), 'from policies\n')
  writeFileSync(join(env, 'seed.sql'), '-- seed\n')
  for (const [path, text] of Object.entries(files)) writeFileSync(join(path === 'workspace.yaml' ? dir : env, path), text)
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

test("workspace.yaml's several copies to one destination arrive in order", () => {
  const dir = workspaceDir({
    'workspace.yaml': [
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
    const plan = mirage.plan(dir, join(dir, 'run'), {})
    assert.deepEqual(
      plan.copies.map((c) => c.to),
      ['/workspace', '/workspace', '/workspace/seed.sql'],
    )
    assert.deepEqual(laid(plan.copies), { 'policy.md': 'policy\n', 'note.md': 'note\n', 'shared.md': 'from notes\n', 'seed.sql': '-- seed\n' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file copied onto a directory that is there goes inside it, and an ENV naming it is the host file', () => {
  const dir = workspaceDir({})
  try {
    const seed = join(dir, 'files', 'seed.sql')
    const copies = [{ to: '/workspace', from: seed }]
    assert.deepEqual(laid(copies), { 'seed.sql': '-- seed\n' })
    assert.equal(copiedPath(copies, '/workspace/seed.sql'), seed)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
