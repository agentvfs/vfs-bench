/** The graders' text helpers, against SQLite's LIKE and Python's string rules. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileLines, like, lines, strip } from '../../../workspace/grader.ts'

const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'

test('LIKE preserves SQLite NUL, wildcard and end-of-string semantics', () => {
  const db = new DatabaseSync(':memory:')
  try {
    const query = db.prepare('SELECT ? LIKE ? AS matched')
    const values = [
      null,
      '',
      '\0NYC',
      'NYC\0Other',
      'Other\0NYC',
      'NYC',
      'NYC\n',
      'NYC\r',
      'NYC\r\n',
      '😀',
      'æ',
      'Æ',
    ]
    const patterns = ['', '%', '_', '%NYC%', 'NYC', 'NYC_', 'NYC\0Other', '%\0NYC', '\0NYC', 'æ']
    for (const value of values)
      for (const pattern of patterns) {
        assert.equal(
          like(value, pattern),
          Boolean(query.get(value, pattern)?.matched),
          JSON.stringify({ value, pattern })
        )
      }
  } finally {
    db.close()
  }
})

test('text helpers match Python whitespace, splitlines and universal newline reads', () => {
  const ref = spawnSync(
    PYTHON,
    [
      '-I',
      '-c',
      `
import io, json
spaces = [chr(n) for n in range(0x110000) if chr(n).isspace()]
breaks = ['\\n', '\\r', '\\r\\n', '\\v', '\\f', '\\x1c', '\\x1d', '\\x1e', '\\x85', '\\u2028', '\\u2029']
values = ['', 'text', '\\ufeff', '\\u200b', '\\x00']
for char in spaces + ['\\ufeff', '\\u200b', '\\x00']:
    values.extend([char, char + 'text' + char, 'a' + char + 'b'])
for first in breaks:
    for second in breaks:
        values.extend([first + second, 'a' + first + 'b' + second])
print(json.dumps([[s, s.strip(), s.splitlines(), [line.removesuffix('\\n') for line in io.StringIO(s, newline=None)]] for s in values]))
`,
    ],
    { encoding: 'utf8' }
  )
  assert.equal(ref.status, 0, ref.stderr)
  for (const [value, trimmed, split, read] of JSON.parse(ref.stdout)) {
    assert.equal(strip(value), trimmed, JSON.stringify(value))
    assert.deepEqual(lines(value), split, JSON.stringify(value))
    assert.deepEqual(fileLines(value), read, JSON.stringify(value))
  }
})
