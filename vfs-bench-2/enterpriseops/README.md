# EnterpriseOps-Gym

[ServiceNow/EnterpriseOps-Gym](https://github.com/ServiceNow/EnterpriseOps-Gym)
@ `271f2c3`, Apache-2.0, with its tasks from the Hugging Face dataset
[ServiceNow-AI/EnterpriseOps-Gym](https://huggingface.co/datasets/ServiceNow-AI/EnterpriseOps-Gym)
@ `c8e538e`. There are 649 public tasks over 7 MCP servers (calendar, CSM,
drive, email, HR, ITSM, Teams; 88 "hybrid" tasks use two). Every task is
graded by SQL checks on the servers' end state (`database_state`
verifiers), so no model judges anything.

Upstream's servers ship only as Docker images
(`shivakrishnareddyma225/enterpriseops-gym-mcp-<domain>`): compiled Python
for five, Python source for email and drive. Here each server is a kit fake
on Mirage's integ kit (`mocks/enterpriseops_<domain>/`), its tools ported
from what the image runs, and checked against the image.

Ported so far: **CSM** (`sn-csm-server`, 89 tools, 103 tasks).

## Setup

```sh
uv run --project enterpriseops python -I enterpriseops/setup.py
```

This clones upstream into `state/enterpriseops/src`, unzips its seed
databases (`gym_dbs.zip`) into `state/enterpriseops/dbs`, and downloads the
dataset's task files into `state/enterpriseops/hf/<mode>/<domain>.parquet`.

Then `harbor/enterpriseops.py` writes the tasks, and
`harbor/enterpriseops.yaml` runs them (harbor/README.md).

## How it maps

| Upstream | Here |
|---|---|
| One Docker image per domain, an MCP server over SQLite | One kit fake per domain, its tools SQL on the run's SQLite (`mocks/enterpriseops/`) |
| `/api/seed-database` makes a database from the task's seed | The fake's `afterSeed` makes the run's file the same way: upstream's own CREATE TABLE statements (the fake's `schema.sql`), then the seed |
| The client lists the server's tools, keeps the task's `selected_tools` | One CLI per server with the task's selected tools, from the image's `tools/list` (`tools/<server>.json`): `sn-csm-server create-new-case --account-id 53 ...` |
| The task's `context` goes as headers on every call (`x-user-email`, tokens) | The CLI's config sends the same headers |
| `benchmark/verifier.py` runs each verifier's query on `/api/sql-runner` | The fake answers each query itself, with the runner's rules, in its private state view; `MirageVerifier` then does upstream's extraction and comparisons in a verifier-only Mirage workspace (`harbor/graders/enterpriseops.ts`). No SQLite, Python or VM in grading. The trial passes when every verifier does, as upstream's `overall_success_rate` counts a run. The reference grader (`tests/grade.py`, upstream's logic over HTTP) runs in a microVM under `harbor/enterpriseops-msb.yaml`, and `MirageParityVerifier` compares the two |
| The model gets the system prompt (the domain's policy) and the user prompt | `instruction.md` is the two, verbatim, then the tools |

## Cost

A server's fake is one Node process per Harbor job (56 MB for CSM), every
trial a run of its own: a 1.3 MB copy of its seeded database, made in
about 50 ms. A tool call takes about 4 ms. No Docker and no VM: all 103
CSM tasks ran 32 at a time in 57 s with `nop`, no errors, grading about 4 s
each.

## How the fakes are checked

`harbor/enterpriseops_compare.py <domain> <calls.json> --seed <file>` runs
upstream's image (by digest) in a local container, seeds both sides from
the same file, sends every call to both, and compares each reply's text and
error flag, then every row of every table. The probes are under
`probes/`. Every CSM seed makes the same database on both sides.

## Divergences from upstream

- Mode: the tasks are upstream's `oracle` mode, each with exactly its
  selected tools. The `plus_<n>_tools` modes add distractor tools; they are
  not written yet.
- Clock: upstream's servers stamp rows with the wall clock. A trial's clock
  starts at the time in the task's id (`task_20251125_152842_...` is
  2025-11-25 15:28:42 UTC), a second per call.
- `CURRENT_TIMESTAMP` in a schema's defaults reads the run's clock.
- Three tasks' contexts have a key with a stray space (`' x-user-email'`),
  which upstream's client sends as a header no server reads. The space is
  dropped here, so those tasks call as the user they name.
- A validation error names the database by its seed's id
  (`db_1762254390925_u5icw4thh`); upstream names the random id its client
  made for the run.
- No reference solutions: upstream ships none. A task's
  `solution/solve.sh` is written here (`solutions/<task id>.sh`), and must
  pass both against upstream's image and against the fake.
