import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MountMode } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'

import { type Send, type Tool, toolsCli } from './cli.ts'

const parameters: Tool['parameters'] = {
  type: 'object',
  properties: {
    count: { type: 'integer' },
    kind: { type: 'string', enum: ['a', 'b'] },
    tags: { type: 'array', items: { type: 'string' } },
    on: { type: 'boolean' },
    meta: { type: 'object' },
  },
  required: ['count', 'kind', 'tags'],
}

/** A workspace with `svc make`, strict or not, and the arguments each call sent. */
function workspace(strict: boolean | undefined) {
  const sent: Record<string, unknown>[] = []
  const send: Send = async (_tool, args) => {
    sent.push(args)
    return { ok: true, result: 'ok' }
  }
  const ws = new Workspace({ '/': [new RAMVFS(), MountMode.WRITE] })
  ws.registerCli('svc', toolsCli('svc', [{ name: 'make', parameters, strict }], undefined, send), { url: 'http://svc' })
  return { ws, sent }
}

test('a strict CLI refuses what its schema refuses, and never sends it', async () => {
  const { ws, sent } = workspace(undefined)
  try {
    const missing = await ws.shell('svc make --kind a --tags x')
    assert.notEqual(missing.exitCode, 0)
    assert.match(missing.stderrText + missing.stdoutText, /--count/)
    const badInt = await ws.shell('svc make --count abc --kind a --tags x')
    assert.notEqual(badInt.exitCode, 0)
    assert.deepEqual(sent, [])
    const ok = await ws.shell(`svc make --count 3 --kind a --tags x --tags y`)
    assert.equal(ok.exitCode, 0, ok.stderrText)
    assert.deepEqual(sent, [{ count: 3, kind: 'a', tags: ['x', 'y'] }])
  } finally {
    await ws.close()
  }
})

test("a list flag's one value may be a JSON array, which says []", async () => {
  const { ws, sent } = workspace(undefined)
  try {
    const result = await ws.shell(`svc make --count 1 --kind b --tags '[]'`)
    assert.equal(result.exitCode, 0, result.stderrText)
    const two = await ws.shell(`svc make --count 1 --kind b --tags '["x", "y"]'`)
    assert.equal(two.exitCode, 0, two.stderrText)
    assert.deepEqual(sent, [
      { count: 1, kind: 'b', tags: [] },
      { count: 1, kind: 'b', tags: ['x', 'y'] },
    ])
  } finally {
    await ws.close()
  }
})

test('a CLI that is not strict sends every call, typed where its values read as the schema says', async () => {
  const { ws, sent } = workspace(false)
  try {
    const loose = await ws.shell(`svc make --count abc --kind c --on maybe --meta '{bad'`)
    assert.equal(loose.exitCode, 0, loose.stderrText)
    const typed = await ws.shell(`svc make --count 3 --kind a --tags '[]' --on true --meta '{"x": 1}'`)
    assert.equal(typed.exitCode, 0, typed.stderrText)
    assert.deepEqual(sent, [
      // Left out, so the service answers that it is missing.
      { count: 'abc', kind: 'c', on: 'maybe', meta: '{bad' },
      { count: 3, kind: 'a', tags: [], on: true, meta: { x: 1 } },
    ])
  } finally {
    await ws.close()
  }
})
