/**
 * The fakes' request models against FastAPI's own answers: each case is
 * what FastAPI 0.162.0 with pydantic 2.14.1 answered for the same body, a
 * model of one field `x`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Field, isReply, model, opt, req } from '../mocks/claweval/store.ts'

const body = (value: unknown) => ({ body: Buffer.from(JSON.stringify(value)) }) as any
const error = (type: string, msg: string, input: unknown, loc: (string | number)[] = ['body', 'x']) => ({
  type,
  loc,
  msg,
  input,
})
const INT = 'Input should be a valid integer, unable to parse string as an integer'
const BOOL = 'Input should be a valid boolean, unable to interpret input'

/** [annotation, value sent, what the handler gets, or FastAPI's 422 detail]. */
const CASES: [Parameters<typeof req>[0], unknown, { value: unknown } | { detail: unknown[] }][] = [
  ['str', 'abc', { value: 'abc' }],
  ['str', 5, { detail: [error('string_type', 'Input should be a valid string', 5)] }],
  ['str', null, { detail: [error('string_type', 'Input should be a valid string', null)] }],
  ['str | None', null, { value: null }],
  ['int', ' 5 ', { value: 5 }],
  ['int', '5.0', { value: 5 }],
  ['int', '1_000', { value: 1000 }],
  ['int', '1e3', { detail: [error('int_parsing', INT, '1e3')] }],
  ['int', true, { value: 1 }],
  ['int', 5.5, { detail: [error('int_from_float', 'Input should be a valid integer, got a number with a fractional part', 5.5)] }],
  ['int', 1e20, { detail: [error('int_parsing_size', 'Unable to parse input string as an integer, exceeded maximum size', 1e20)] }],
  ['int', [], { detail: [error('int_type', 'Input should be a valid integer', [])] }],
  ['int | None', 'abc', { detail: [error('int_parsing', INT, 'abc')] }],
  ['float', '1e3', { value: 1000 }],
  ['float', '0x10', { detail: [error('float_parsing', 'Input should be a valid number, unable to parse string as a number', '0x10')] }],
  ['float', null, { detail: [error('float_type', 'Input should be a valid number', null)] }],
  ['bool', 'yes', { value: true }],
  ['bool', 'OFF', { value: false }],
  ['bool', ' true ', { detail: [error('bool_parsing', BOOL, ' true ')] }],
  ['bool', 1, { value: true }],
  ['bool', 2, { detail: [error('bool_parsing', BOOL, 2)] }],
  ['bool', 5.5, { detail: [error('bool_type', 'Input should be a valid boolean', 5.5)] }],
  ['bool | None', null, { value: null }],
  ['list[str]', [], { value: [] }],
  ['list[str]', 'a', { detail: [error('list_type', 'Input should be a valid list', 'a')] }],
  [
    'list[str]',
    [1, 2],
    {
      detail: [
        error('string_type', 'Input should be a valid string', 1, ['body', 'x', 0]),
        error('string_type', 'Input should be a valid string', 2, ['body', 'x', 1]),
      ],
    },
  ],
  ['list[str] | None', null, { value: null }],
]

test('a field takes and refuses what FastAPI takes and refuses', () => {
  for (const [type, value, want] of CASES) {
    const got = model(body({ x: value }), { x: req(type) })
    if ('value' in want) assert.deepEqual(isReply(got) ? got : got.x, want.value, `${type} ${JSON.stringify(value)}`)
    else assert.deepEqual(got, { status: 422, body: { detail: want.detail } }, `${type} ${JSON.stringify(value)}`)
  }
})

test("a model's errors come in its fields' order, missing and invalid alike", () => {
  const fields: Record<string, Field> = { a: req('str'), b: req('int'), c: opt('int', 3) }
  const sent = { b: 'x', c: 'y' }
  assert.deepEqual(model(body(sent), fields), {
    status: 422,
    body: {
      detail: [
        error('missing', 'Field required', sent, ['body', 'a']),
        error('int_parsing', INT, 'x', ['body', 'b']),
        error('int_parsing', INT, 'y', ['body', 'c']),
      ],
    },
  })
  assert.deepEqual(model(body({ a: 'q', b: '7' }), fields), { a: 'q', b: 7, c: 3 })
})
