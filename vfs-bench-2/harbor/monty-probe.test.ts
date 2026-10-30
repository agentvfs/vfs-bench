/** Feasibility checks only: no dataset is routed to Monty yet. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { after, test } from 'node:test'
import { MontyRuntime } from '@struktoai/mirage-core/runtime/python/monty/runtime'
import { Limit, MountMode, PathSpec } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace } from '@struktoai/mirage-core/workspace/workspace/workspace'
import { quote } from './graders/context.ts'

// The development-linked Mirage checkout has its own 1.0.0 dev dependency.
// Only this test process redirects that optional peer to the application's
// exact 1.4.0 pin. Production needs the same version resolved by its runtime
// before any dataset can switch; changing the application's pin alone is not
// enough for a linked package. No upstream files or shared installs are changed.
const montyUrl = import.meta.resolve('@pydantic/monty')
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@pydantic/monty'
      ? { url: montyUrl, shortCircuit: true }
      : nextResolve(specifier, context)
  },
})
after(() => hooks.deregister())

async function workspace(value: number): Promise<Workspace> {
  const input = new RAMVFS()
  await input.write(
    new PathSpec({ virtual: '/state.json', directory: '/', vfsPath: 'state.json' }),
    new TextEncoder().encode(JSON.stringify({ value }))
  )
  return new Workspace(
    {
      '/': [new RAMVFS(), MountMode.EXEC],
      '/input': [input, MountMode.READ],
      '/output': [new RAMVFS(), MountMode.WRITE],
    },
    {
      runtimes: [new MontyRuntime({ config: { maxMemory: 64 * 1024 * 1024 } }), 'workspace'],
      commandLimits: { '@line': new Limit({ timeoutSeconds: 10 }) },
    }
  )
}

test('Monty 1.4.0 reads frozen Mirage state and writes rewards in isolated VFS workspaces', async () => {
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', montyUrl), 'utf8')).version, '1.4.0')
  const run = async (value: number) => {
    const ws = await workspace(value)
    try {
      const code = `
import json
from decimal import Decimal
from pathlib import Path
state = json.loads(Path('/input/state.json').read_text())
assert 'a\\x1cb'.splitlines() == ['a', 'b']
assert '\\x85'.strip() == ''
reward = state['value'] + int(Decimal('0.1') + Decimal('0.2') == Decimal('0.3'))
Path('/output/reward.json').write_text(json.dumps({'reward': reward}))
`
      const result = await ws.shell('python -c ' + quote(code) + ' && cat /output/reward.json')
      assert.equal(result.exitCode, 0, result.stderrText)
      return JSON.parse(result.stdoutText)
    } finally {
      await ws.close()
    }
  }
  assert.deepEqual(await Promise.all([run(10), run(20)]), [{ reward: 11 }, { reward: 21 }])
})

test('Monty grading probe cannot write frozen inputs or load host-only modules', async () => {
  const ws = await workspace(10)
  try {
    const code = `
from pathlib import Path
try:
    Path('/input/state.json').write_text('changed')
    raise AssertionError('read-only input was writable')
except OSError as error:
    assert 'Read-only file system' in str(error)
assert Path('/input/state.json').read_text() == '{"value":10}'
assert not Path('/etc/passwd').exists()
print('confined')
`
    const result = await ws.shell('python -c ' + quote(code))
    assert.equal(result.exitCode, 0, result.stderrText)
    assert.equal(result.stdoutText.trim(), 'confined')
    for (const name of ['sqlite3', 'subprocess', 'socket', 'pandas', 'pydantic']) {
      const refused = await ws.shell('python -c ' + quote('import ' + name))
      assert.notEqual(refused.exitCode, 0, name)
      assert.match(refused.stderrText, /ModuleNotFoundError/, name)
    }
  } finally {
    await ws.close()
  }
})
