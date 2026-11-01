# ERPBench-100

[blobfishai/erp-agent-simulation](https://github.com/blobfishai/erp-agent-simulation)
@ `5bdf458`, code Apache-2.0, data CC BY 4.0. A task is one tenant of a
synthetic ERP world in ten workflow families (order import, shipment
verification, collections, reorder, receiving and AP match, document
compliance, shift roll-up, channel order sync, hiring, price lists), over
six systems: `erpbench`, `oracle_fusion`, `gmail`, `google_drive`,
`google_sheets` and `slack`, 52 tools on one SQLite file. Upstream's grader
scores the world's end state, the submitted answers and the call trace:
reads before the first write, a readback after each write. No model judges
anything.

All 100 tasks are ported (`datasets/erpbench/<task>/`).

## Setup

From `vfs-bench-2/`:

```sh
uv run --project datasets/erpbench python -I datasets/erpbench/fetch.py
uv run --project formats/harbor harbor run -c datasets/erpbench/jobs/harbor.yaml -a oracle -n 8
```

`fetch.py` clones upstream into `state/erpbench/src` and runs
`generate.py`, which writes what is not committed: each task's
`workspace/verifier/task.json` (upstream's task, with its expected answers
and rubric, which the grader reads), its `harbor/solution/solve.sh`, and
what the fake reads outside the workspace, `state/erpbench/kit/<task>.json`:
upstream's seeded world as SQL, the world model and the task fields
upstream's tools read. The fixture names only the task, so nothing the
agent can reach holds the expected answers or the rubric.
`generate.py --check` checks every task against upstream.

## How it maps

| Upstream | Here |
|---|---|
| `world` container: `service.py`, `ErpWorld` over a task-local SQLite, MCP over HTTP | The `erpbench` kit fake (`mocks/erpbench/`), one Node process per Harbor job and a run per trial: `world.ts` ports `ErpWorld._dispatch` and its views statement for statement; a run's file is upstream's seeded world, replayed from `iterdump` |
| `[[environment.mcp_servers]]`, one per system | One CLI per system (`workspace/tools.json`, `workspace/tools.ts`): `oracle-fusion sales-orders create --task-id ...`. Slack's is `slack-tools`, as Mirage registers a `slack` CLI of its own |
| `tests/verify.py`, over `evidence.json` (baseline, snapshot, trace) | Ported to TypeScript, `graders/index.ts`, on `MirageVerifier`: the fake's private state view serves the seeded world, the world now, the trace (each call as `ErpWorld._record` makes it) and the world model, as `json.dumps` text, and `task.json` the rubric. No SQLite, Python or VM in grading |
| `solution/solve.py`, the reference's `oracle_steps` over HTTP | `harbor/solution/solve.sh`, the same steps as CLI calls |

The six systems stay in one fake rather than Mirage's integ fakes: every
task uses `oracle_fusion` and `erpbench`, which have none, and the grader
reads one world's state and one trace across all six.

## How the fake and grader are checked

`tests/compare.py` runs every task under each of upstream's seven
policies (`oracle`, `noop`, `shortcut`, `state_only`, `wrong_source`,
`wrong_target`, `overprocess`) and a set of malformed calls per workflow
family, against upstream's `ErpWorld` and a fresh run of the fake, the
arguments as the CLI sends them: 710 runs, 14,934 calls, no difference in
replies, error texts, the 31 tables (after each seed and at the end) or the
trace. Upstream's grader over the fake's end state gives upstream's reward
for all 700 task × policy runs, and the native grader, on the state the
fake's verifier view serves, gives the same reward and passes the same
rubric checks. `tests/grader.test.ts` covers the end states those policies
never reach (answers within or past 0.005, figures in other formats,
labels for ids, register rows misplaced, out-of-scope writes, a second
record, values upstream raises on): upstream's `score_episode` and the
native grader must agree on each.

## Oracle

All 100 tasks: the oracle scores 1.0 and doing nothing 0.03, as on
upstream's Docker environment. The 0.03 is upstream's
`containment:task_scope` (3 points), which passes while nothing changes.

## Divergences

- **Whole floats inside untyped JSON arrays.** The CLI reads a JSON flag
  with `JSON.parse` and sends it with `JSON.stringify`, so `41180.0` in an
  order's `lines` arrives as `41180`; the fake restores floats only where
  the schema types a value `number`. It changes what a few stored payloads
  look like, and none of the 700 compared rewards.
- **Replies.** The CLI prints a reply as JSON reparsed in JavaScript, so a
  whole float shows as `41180` where upstream's MCP text has `41180.0`.
- **Files are CLIs.** Upstream's files are in its Google Drive and Sheets,
  which are CLIs here, not mounts.
