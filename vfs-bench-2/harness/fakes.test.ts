/** `pnpm test`: the harness's own checks, which need no dataset. */
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { start } from './fakes.ts'
import { Run } from './runs.ts'

test("a fake gets the harness's environment but not the model's credentials", async () => {
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1'
  // Prints what it was given, then its ready line, and waits to be stopped.
  const probe = `
    const { OPENAI_API_KEY, OPENAI_BASE_URL, HOME } = process.env
    console.log('ENV ' + JSON.stringify({ OPENAI_API_KEY, OPENAI_BASE_URL, HOME }))
    console.log('PROBE_URL=http://127.0.0.1:1')
    setInterval(() => {}, 1000)
  `
  const run = new Run('fakes-test', tmpdir())
  const fake = await start({ name: 'PROBE', argv: [process.execPath, '-e', probe] }, run)
  try {
    const line = fake.log.find((l) => l.startsWith('ENV '))
    assert.ok(line !== undefined, fake.log.join('\n'))
    assert.deepEqual(JSON.parse(line.slice(4)), { HOME: process.env.HOME })
    // The harness keeps them, for the model and a grader's judge.
    assert.equal(process.env.OPENAI_API_KEY, 'sk-test')
    assert.equal(process.env.OPENAI_BASE_URL, 'http://127.0.0.1:9/v1')
  } finally {
    await fake.stop()
  }
})
