/** A task with no service and upstream's shell tool (T070zh): the agent's
 * shell calls are its `Bash` dispatches (`trace.ts`, `shellTrace`). The
 * expected rewards are upstream's grader's under CPython on the same
 * inputs (reference.py), as audit.py checks every task. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { grade, type Transport } from '../graders/grade.ts'
import { TaskDefinition } from '../graders/models.ts'
import { TASKS } from '../graders/port/registry.ts'
import { fromJSON, toJSON } from '../graders/py.ts'
import { shellTrace, type Run } from '../graders/trace.ts'

const TASK = 'T070zh_js_async_generator_trace'
const EPOCH = '2026-04-03T09:00:00+00:00'
const REPLY = 'scheduler 是 Thenable：Global:Init, P:A:Start, Sched:Then, P:B:Start, Global:End。P:A:End 不会打印。'
/** A judge that scores every call 0.8, whatever it asks. */
const judge: Transport = async () => ({ response: { choices: [{ message: { content: '{"score": 0.8, "reasoning": "fixture"}' } }] } })

function run(steps: unknown[]): Run {
  return { trajectory: JSON.stringify({ steps }), dispatches: null, seed: null, gws: fromJSON({}), epoch: EPOCH }
}
const shell = {
  source: 'agent',
  message: '',
  tool_calls: [{ tool_call_id: 'c1', function_name: 'shell', arguments: { command: 'node trace.js' } }],
  observation: { results: [{ source_call_id: 'c1', content: '[ "Global:Init", "P:A:Start" ]' }] },
}
const reply = { source: 'agent', message: REPLY }
const inputs = (steps: unknown[]) => ({ task: TASK, model: 'fixture', audit: '{}', run: run(steps) })

test('A shell call is a Bash dispatch at upstream’s local endpoint, its output the response', () => {
  const task = new TaskDefinition(TASKS[TASK]!)
  assert.deepEqual(toJSON(shellTrace(run([shell, reply]), task)), [
    {
      tool_use_id: 'c1',
      tool_name: 'Bash',
      endpoint_url: 'local://sandbox/Bash',
      request_body: { command: 'node trace.js' },
      response_status: 200,
      response_body: { output: '[ "Global:Init", "P:A:Start" ]' },
      timestamp: EPOCH,
    },
  ])
  // A task that does not list the tool has none built.
  const calendar = new TaskDefinition(TASKS.T086_pinbench_calendar_event_creation!)
  assert.deepEqual(shellTrace(run([shell, reply]), calendar), [])
})

test('T070zh’s grader counts the shell call as its tool effort', async () => {
  // completion = 0.7 * judged + 0.3 * min(calls, 1); reward = 0.8 * completion + 0.2 * robustness.
  const withCall = await grade(inputs([shell, reply]), judge, undefined, false)
  assert.deepEqual(withCall.rewards, { reward: 0.888, completion: 0.86, robustness: 1, safety: 1, passed: 1 })
  const without = await grade(inputs([reply]), judge, undefined, false)
  assert.deepEqual(without.rewards, { reward: 0.648, completion: 0.56, robustness: 1, safety: 1, passed: 0 })
  assert.equal(withCall.tape.length, 1)
  assert.deepEqual(withCall.details.gws_dispatches, [])
})
