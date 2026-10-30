import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { automationWorkspace, verifyAutomation } from './verify-automationbench.ts'

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./graders/automationbench/fixtures/${name}.json`, import.meta.url), 'utf8')
  )
const request = (data: any) => ({
  task: data.task,
  timeoutSeconds: 20,
  files: {
    '/input/task.json': Buffer.from(data.task_json).toString('base64'),
    '/input/state.json': Buffer.from(JSON.stringify(data.state)).toString('base64'),
  },
})

test('AutomationBench replays real oracle states, including HubSpot aliases, in isolated parallel workspaces', async () => {
  const inputs = ['finance-invoice-email-extract', 'operations-hubspot-ticket-escalation'].map(fixture)
  const results = await Promise.all(inputs.map((data) => verifyAutomation(request(data))))
  results.forEach((result, i) => assert.deepEqual(result.checks, inputs[i].expected))
})

test('AutomationBench input/task pins, read-only mounts and absent host capabilities', async () => {
  const input = fixture('finance-invoice-email-extract'),
    req = request(input)
  await assert.rejects(verifyAutomation({ ...req, task: '../unknown' }), /Unregistered/)
  await assert.rejects(
    verifyAutomation({
      ...req,
      files: { ...req.files, '/input/task.json': Buffer.from('{}').toString('base64') },
    }),
    /task changed/
  )
  await assert.rejects(
    verifyAutomation({ ...req, files: { ...req.files, '/host/file': '' } }),
    /Invalid frozen/
  )
  const workspace = await automationWorkspace(req)
  try {
    assert.notEqual((await workspace.shell('echo fake > /input/state.json')).exitCode, 0)
    assert.notEqual((await workspace.shell('cat /etc/passwd')).exitCode, 0)
    for (const module of ['sqlite3', 'pydantic', 'subprocess', 'socket'])
      assert.notEqual((await workspace.shell(`python -c 'import ${module}'`)).exitCode, 0)
  } finally {
    await workspace.close()
  }
})

test('AutomationBench fails closed on malformed world and timeout without rewarding a prior trial', async () => {
  const input = fixture('finance-invoice-email-extract'),
    req = request(input)
  await assert.rejects(verifyAutomation({ ...req, timeoutSeconds: 0.00001 }), /failed|timeout|time limit/i)
  input.state.doc.find((row: any) => row.name === 'world').doc = '{} garbage'
  await assert.rejects(verifyAutomation(request(input)), /Monty grader failed/)
})

test('model adapter preserves hidden updates, broken guards, explicit scoring and exact numeric types', async () => {
  const workspace = await automationWorkspace(request(fixture('finance-invoice-email-extract')))
  const read = (name: string) =>
    readFileSync(new URL('./graders/automationbench/' + name, import.meta.url), 'utf8')
  // Run the same trusted adapter and generated functions; this probe's custom
  // assertions are test code and never accepted by the production verifier.
  const probe = `
initial = {"google_sheets": {"rows": [{"id": "row", "spreadsheet_id": "sheet", "worksheet_id": "tab", "row_id": 1, "cells": {}}]}}
world = build_model("world.WorldState", initial)
positive = {"type": "google_sheets_row_updated", "spreadsheet_id": "sheet", "worksheet_id": "tab", "row_id": 1}
negative = {**positive, "type": "google_sheets_row_not_updated"}
assert check_assertion(world, positive) is False
model_set(model_get(world, "google_sheets"), "_updated_row_keys", {"sheet:tab:1"})
assert check_assertion(world, positive) is True
state = {"world": world, "initial_state": initial, "info": {"assertions": [positive, negative]}}
assert ab_rubric__partial_credit(state) == 0.5
assert [a["excluded"] for a in state["_assertion_results"]] == [False, False]
state["info"]["assertions"] = [positive, {**negative, "scored": False}]
assert ab_rubric__partial_credit(state) == 1.0
state["info"]["assertions"] = [{**positive, "excluded": True}]
assert ab_rubric__partial_credit(state) == 0.0
state["initial_state"] = {}
state["info"]["assertions"] = [{**positive, "excluded": False}]
assert ab_rubric__partial_credit(state) == 1.0
assert convert({"k": "int"}, "9007199254740993.0") == 9007199254740993
assert convert({"k": "int"}, 10 ** 400) == 10 ** 400
assert convert({"k": "decimal"}, "0.1000000000000000001") == Decimal("0.1000000000000000001")
assert convert({"k": "union", "of": [{"k": "int"}, {"k": "str"}]}, "001") == "001"
for bad in ["1.00000000000000001", "1e3", "nan"]:
    try:
        convert({"k": "int"}, bad)
    except ValueError:
        continue
    raise AssertionError(bad)
assert url_unquote("caf%C3%A9%20%FF") == "café �"
print("model parity probes passed")
`
  try {
    await workspace.vfs.write(
      '/grader/probe.py',
      [
        read('model_runtime.py'),
        'MODELS = json.loads(Path("/input/models.json").read_text())',
        read('port.py'),
        probe,
      ].join('\n')
    )
    const result = await workspace.shell('python /grader/probe.py')
    assert.equal(result.exitCode, 0, result.stderrText)
    assert.match(result.stdoutText, /model parity probes passed/)
  } finally {
    await workspace.close()
  }
})
