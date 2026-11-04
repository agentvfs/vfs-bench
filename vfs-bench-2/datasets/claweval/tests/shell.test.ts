/** A task with no service and upstream's shell tool (T070zh): the shell
 * commands the agent ran, as the verifier stages them from the workspace's
 * history, are its `Bash` dispatches (`trace.ts`, `shellTrace`); a tool
 * call that ran no command (a read) is none. The expected rewards are
 * upstream's grader's under CPython on the same inputs (reference.py), as
 * audit.py checks every task. */
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

/** The workspace's history of one command, as the daemon lists it. */
const HISTORY = [
  { type: 'command', session: 's', timestamp: 1775206801026, cwd: '/', id: 'exec_1', command: 'node trace.js' },
  {
    type: 'result',
    session: 's',
    timestamp: 1775206801036,
    cwd: '/',
    parent: 'exec_1',
    duration_ms: 10,
    exit_code: 0,
    stdout: '[ "Global:Init", "P:A:Start" ]',
    stderr: '',
  },
]
/** A read with Claude Code's MCP tool, then the reply: no command ran. */
const READ = {
  source: 'agent',
  message: '',
  tool_calls: [{ tool_call_id: 'c1', function_name: 'mcp__mirage__read', arguments: { path: '/VFS.md' } }],
  observation: { results: [{ source_call_id: 'c1', content: '# Workspace' }] },
}
const reply = { source: 'agent', message: REPLY }

function run(steps: unknown[], history: unknown[] | null): Run {
  return {
    trajectory: JSON.stringify({ steps }),
    dispatches: null,
    seed: null,
    history: history === null ? null : JSON.stringify(history),
    gws: fromJSON({}),
    epoch: EPOCH,
  }
}
const inputs = (steps: unknown[], history: unknown[] | null) => ({ task: TASK, model: 'fixture', audit: '{}', run: run(steps, history) })

test('A command the agent ran is a Bash dispatch at upstream’s local endpoint, its result the response', () => {
  const task = new TaskDefinition(TASKS[TASK]!)
  assert.deepEqual(toJSON(shellTrace(run([reply], HISTORY), task)), [
    {
      tool_use_id: 'exec_1',
      tool_name: 'Bash',
      endpoint_url: 'local://sandbox/Bash',
      request_body: { command: 'node trace.js' },
      response_status: 200,
      response_body: { exit_code: 0, stdout: '[ "Global:Init", "P:A:Start" ]', stderr: '' },
      timestamp: EPOCH,
    },
  ])
  // A command cut off before its result answers as upstream's timeout does.
  const cut = toJSON(shellTrace(run([reply], [HISTORY[0]]), task)) as any[]
  assert.deepEqual(cut[0].response_body, { exit_code: -1, stdout: '', stderr: '' })
  // A tool call that ran no command is none, and a task that does not list
  // the tool has none built.
  assert.deepEqual(shellTrace(run([READ, reply], []), task), [])
  assert.deepEqual(shellTrace(run([READ, reply], null), task), [])
  const calendar = new TaskDefinition(TASKS.T086_pinbench_calendar_event_creation!)
  assert.deepEqual(shellTrace(run([reply], HISTORY), calendar), [])
})

test('T070zh’s grader counts the command as its tool effort, and a read as none', async () => {
  // completion = 0.7 * judged + 0.3 * min(commands, 1); reward = 0.8 * completion + 0.2 * robustness.
  const withCommand = await grade(inputs([READ, reply], HISTORY), judge, undefined, false)
  assert.deepEqual(withCommand.rewards, { reward: 0.888, completion: 0.86, robustness: 1, safety: 1, passed: 1 })
  const readOnly = await grade(inputs([READ, reply], []), judge, undefined, false)
  assert.deepEqual(readOnly.rewards, { reward: 0.648, completion: 0.56, robustness: 1, safety: 1, passed: 0 })
  assert.equal(withCommand.tape.length, 1)
  assert.deepEqual(withCommand.details.gws_dispatches, [])
})
