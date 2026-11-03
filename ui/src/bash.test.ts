import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tokens } from './bash.ts'

test('a line: its command, flags, strings, expansions and operators', () => {
  assert.deepEqual(tokens(`light-shop add-to-cart --sid "$sid" --cnt 4 | jq '.output' 2>&1`), [
    ['cmd', 'light-shop'],
    ['text', ' add-to-cart '],
    ['flag', '--sid'],
    ['text', ' '],
    ['str', '"'],
    ['var', '$sid'],
    ['str', '"'],
    ['text', ' '],
    ['flag', '--cnt'],
    ['text', ' 4 '],
    ['op', '|'],
    ['text', ' '],
    ['cmd', 'jq'],
    ['text', ' '],
    ['str', "'.output'"],
    ['text', ' '],
    ['op', '2>&1'],
  ])
})

test('a script: comments, assignments, substitutions, keywords and a heredoc', () => {
  const script = [
    '# Book the flight.',
    'fid=$(light-flight search-flights --date 2026-02-27)',
    'for bid in $(cat ids); do light-flight remove-from-booking --bid "$bid"; done',
    "cat > /tmp/x <<'EOF'",
    'not $code here',
    'EOF',
    'echo ok',
  ].join('\n')
  const kinds = (kind: string) => tokens(script).filter(([k]) => k === kind).map(([, t]) => t)
  assert.deepEqual(kinds('com'), ['# Book the flight.'])
  assert.deepEqual(kinds('cmd'), ['light-flight', 'cat', 'light-flight', 'cat', 'echo'])
  assert.deepEqual(kinds('kw'), ['for', 'in', 'do', 'done'])
  assert.deepEqual(kinds('var'), ['fid', '$(', '$(', '$bid'])
  assert.deepEqual(kinds('str'), ['"', '"', 'not $code here'])
  assert.ok(tokens(script).some(([k, t]) => k === 'op' && t === "<<'EOF'"))
  // Nothing is lost: the tokens are the text.
  assert.equal(tokens(script).map(([, t]) => t).join(''), script)
})
