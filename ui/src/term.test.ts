import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Line } from './api.ts'
import { beats, code, next, output, PROMPT, REPLAY, typed, unwritten } from './term.ts'

const line = (over: Partial<Line> = {}): Line => ({ command: 'echo hi', stdout: '', stderr: '', exit: 0, at: 0, ms: 0, ...over })
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '')

test('a command as bash echoes it typed: its code, a row that goes on with it behind `> `', () => {
  assert.equal(code('# header\n\nlight-talk get-myuid\n  # note'), 'light-talk get-myuid')
  assert.equal(plain(typed("cat <<A\nx\nA").join('')), 'cat <<A\n> x\n> A')
  assert.match(typed('light-talk x')[0], /^\x1b\[38;2;130;80;223ml\x1b\[0m$/)
  assert.equal(plain(PROMPT), '$ ')
})

test('what a line wrote ends its rows, then a nonzero exit', () => {
  assert.equal(plain(output(line({ stdout: 'a', stderr: 'b\n', exit: 2 }))), 'a\nb\nexit 2\n')
  assert.equal(output(line({ exit: null })), '')
  assert.equal(output(line()), '')
})

test('a live terminal prompts once, then writes each line as it starts and ends', () => {
  const written = unwritten()
  assert.equal(plain(next([], written)), '$ ')
  assert.equal(next([], written), '')
  const running = line({ exit: null, stdout: '' })
  assert.equal(plain(next([running], written)), 'echo hi\n')
  assert.equal(next([running], written), '')
  assert.equal(plain(next([line({ stdout: 'hi\n' })], written)), 'hi\n$ ')
  assert.equal(next([line({ stdout: 'hi\n' })], written), '')
})

test('a replay waits before each line, types it and runs it, each cut to a cap', () => {
  const [first, second] = beats([line({ at: 0, ms: 10_000 }), line({ command: 'x', at: 60_000 })])
  assert.equal(first.start, REPLAY.first)
  assert.equal(first.typed, first.start + 'echo hi'.length * REPLAY.perChar)
  assert.equal(first.done, first.typed + REPLAY.run)
  assert.equal(second.start, first.done + REPLAY.idle)
})
