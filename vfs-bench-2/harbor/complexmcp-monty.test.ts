import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyComplex } from './verify-complexmcp.ts'

const run = (state: unknown) =>
  verifyComplex({
    task: 'mark-sean-baker-read',
    timeoutSeconds: 20,
    files: {
      '/input/state.json': Buffer.from(typeof state === 'string' ? state : JSON.stringify(state)).toString(
        'base64'
      ),
    },
  })

test('ComplexMCP preserves counts, excluded IDs, additions, removals and rounded floats', async () => {
  const result = await run({
    initial: { changed: 1, removed: [1, 2], stable: false, balance: 0.1234561, trid: 1 },
    final: { changed: 2, removed: [1], stable: true, balance: 0.1234562, trid: 999, extra: 7 },
    expected: { changed: 2, removed: [1], stable: false, balance: 0.1234563, trid: 8 },
  })
  assert.deepEqual(result.rewards, { reward: 0, total: 2, recall: 2, misbehave: 2 })
})

test('ComplexMCP fuzzy matching uses Unicode edit distance and strict threshold', async () => {
  const pairs = [
    ['abcdefghij', 'abcdefgxyz', false], // distance 3/10: exactly 0.7 is refused
    ['abcdefghij', 'abcdefghxy', true],
    ['0123456789 target', 'target', true], // asymmetric substring
    ['target', '0123456789 target', false],
    ['é😀中abc', 'é😀中abd', true],
    ['\u0085STRASSE\u001c', 'strasse', true],
    ['abc', 'abd', false],
    ['', '', true],
  ] as const
  const initial = {},
    final: Record<string, unknown> = {},
    expected: Record<string, unknown> = {}
  for (const [i, [actual, gold]] of pairs.entries()) {
    final[i] = { content: actual }
    expected[i] = { content: gold }
  }
  const result = await run({ initial, final, expected })
  assert.deepEqual(result.rewards, {
    reward: 0,
    total: pairs.length,
    recall: pairs.filter((x) => x[2]).length,
    misbehave: 0,
  })
})

test('ComplexMCP preserves Python integers through byte transport and isolates parallel workspaces', async () => {
  const [a, b] = await Promise.all([
    run(
      '{"initial":{"x":9007199254740992},"final":{"x":9007199254740993},"expected":{"x":9007199254740993}}'
    ),
    run({ initial: { x: 1 }, final: { x: 1 }, expected: { x: 2 } }),
  ])
  assert.deepEqual(a.rewards, { reward: 1, total: 1, recall: 1, misbehave: 0 })
  assert.deepEqual(b.rewards, { reward: 0, total: 1, recall: 0, misbehave: 0 })
})

test('ComplexMCP refuses unknown tasks and times out expensive grading without rewards', async () => {
  await assert.rejects(verifyComplex({ task: '../unknown', files: {}, timeoutSeconds: 10 }), /Unregistered/)
  await assert.rejects(
    verifyComplex({
      task: 'mark-sean-baker-read',
      timeoutSeconds: 0.001,
      files: {
        '/input/state.json': Buffer.from(JSON.stringify({ initial: {}, final: {}, expected: {} })).toString(
          'base64'
        ),
      },
    }),
    /failed|timeout|time limit/i
  )
})

test('ported Levenshtein matches an independent Unicode dynamic program in Monty', async () => {
  const { readFileSync } = await import('node:fs')
  const { MontyRuntime } = await import('@struktoai/mirage-core/runtime/python/monty/runtime')
  const { MountMode } = await import('@struktoai/mirage-core/types')
  const { RAMVFS } = await import('@struktoai/mirage-core/vfs/ram/ram')
  const { Workspace } = await import('@struktoai/mirage-core/workspace/workspace/workspace')
  const { quote } = await import('./graders/context.ts')
  let seed = 17
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0)
  const alphabet = Array.from('abCé中😀\u0301')
  const word = () =>
    Array.from({ length: random() % 70 }, () => alphabet[random() % alphabet.length]).join('')
  const pairs = Array.from({ length: 500 }, () => [word(), word()])
  pairs.push(['a'.repeat(5000), 'a'.repeat(4999) + 'b'])
  const similarity = ([x, y]: string[]) => {
    const a = Array.from(x),
      b = Array.from(y)
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      const next = [i]
      for (let j = 1; j <= b.length; j++)
        next.push(Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1])))
      previous = next
    }
    return Math.max(a.length, b.length) ? 1 - previous[b.length] / Math.max(a.length, b.length) : 1
  }
  const expected = pairs.map(similarity)
  const runtime = new MontyRuntime({ config: { maxMemory: 128 * 1024 * 1024 } })
  runtime.shared = false
  const workspace = new Workspace(
    { '/': [new RAMVFS(), MountMode.EXEC] },
    { runtimes: [runtime, 'workspace'] }
  )
  try {
    const code =
      readFileSync(new URL('./graders/complexmcp/levenshtein.py', import.meta.url), 'utf8') +
      '\nimport json\npairs = json.loads(' +
      JSON.stringify(JSON.stringify(pairs)) +
      ')\nprint(json.dumps([lev_sim(x,y) for x,y in pairs]))'
    const result = await workspace.shell('python -c ' + quote(code))
    assert.equal(result.exitCode, 0, result.stderrText)
    assert.deepEqual(JSON.parse(result.stdoutText), expected)
  } finally {
    await workspace.close()
  }
})
