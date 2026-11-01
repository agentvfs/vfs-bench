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

## Fetch and run

From `vfs-bench-2/`:

```sh
uv run --project datasets/enterpriseops python -I datasets/enterpriseops/fetch.py
uv run --project datasets/enterpriseops python -I datasets/enterpriseops/generate.py --check
uv run --project formats/harbor harbor run -c datasets/enterpriseops/jobs/harbor.yaml -a oracle -n 103
```

`fetch.py` clones upstream into `state/enterpriseops/src`, unzips its seed
databases (`gym_dbs.zip`) into `state/enterpriseops/dbs`, and downloads the
dataset's task files into `state/enterpriseops/hf/<mode>/<domain>.parquet`.
`generate.py` writes the tasks from them, and the oracle job grades all 103
solutions at once.

This takes about 60 s, with no errors. Every trial gets its own run of the
shared fake, so the results are the same at any concurrency: 16, 32, 64 and
103 gave the same reward and verifier count for every task. Each trial has
its own Mirage daemon, and at most one per core boots at a time
(`VFSBENCH_DAEMON_BOOTS` changes that), so many trials do not starve each
other's startup.

Grading is Mirage-native. When the grader was ported, it agreed with
upstream's logic (in Python, over HTTP) on all 103 tasks.

## How it maps

| Upstream | Here |
|---|---|
| One Docker image per domain, an MCP server over SQLite | One kit fake per domain, its tools SQL on the run's SQLite (`mocks/enterpriseops/`) |
| `/api/seed-database` makes a database from the task's seed | The fake's `afterSeed` makes the run's file the same way: upstream's own CREATE TABLE statements (the fake's `schema.sql`), then the seed |
| The client lists the server's tools, keeps the task's `selected_tools` | One CLI per server with the task's selected tools, from the image's `tools/list` (`tools/<server>.json`): `sn-csm-server create-new-case --account-id 53 ...` |
| The task's `context` goes as headers on every call (`x-user-email`, tokens) | The CLI's config sends the same headers |
| `benchmark/verifier.py` runs each verifier's query on `/api/sql-runner` | The fake answers each query itself, with the runner's rules, in its private state view; `MirageVerifier` then does upstream's extraction and comparisons in a verifier-only Mirage workspace (`graders/index.ts`). No SQLite, Python or VM in grading. The trial passes when every verifier does, as upstream's `overall_success_rate` counts a run |
| The model gets the system prompt (the domain's policy) and the user prompt | `harbor/instruction.md` is the two, verbatim, then the tools |

## Cost

A server's fake is one Node process per Harbor job (56 MB for CSM), every
trial a run of its own: a 1.3 MB copy of its seeded database, made in
about 50 ms. A tool call takes about 4 ms. No Docker and no VM: all 103
CSM tasks ran 32 at a time in 57 s with `nop`, no errors, grading about 4 s
each.

## How the mocks were checked

When the CSM mock was made, it was run beside upstream's image (by digest):
both seeded from the same file, every call sent to both, each reply's text
and error flag compared, then every row of every table. Every CSM seed made
the same database on both sides.

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
- Upstream ships no reference solutions. Each task's `harbor/solution/solve.sh`
  is written here (`solutions/<task id>.json`, the calls in order, using
  only the task's tools and following its policy), and was checked the
  same way: the same replies and tables on upstream's image and the mock,
  and the task's verifiers run on both.

## Oracle

The oracle job scores 94 of the 103
CSM tasks 1.0. The other 9 cannot pass as upstream grades them:

| Task | Upstream's problem |
|---|---|
| `task_20260107_162554_472_accab84d_41d2e871`, `task_20260108_160928_699_391f1eff_905701cb`, `task_20260121_143201_590_1afb323a_5a03bf03`, `task_20260121_145409_648_1afb323a_4e203caa`, `task_20260121_150447_596_1afb323a_0a1e4085`, `task_20260121_163208_054_1afb323a_7f40ee66` | Every expected value is a string (`"1"`), and upstream's comparison is `actual == expected`, so the integer each query returns never matches. The solutions reach the end state the queries check. |
| `task_20251201_164641_724_109c89c0_1b29acb9` | Its 44 verifiers are 11 copies of 4 checks, some wanting the new case `new` and some `resolved`. The solution follows the policy (`new`): 32 of 44. |
| `task_20260106_192119_816_ad5a67e3_87a5a87c` | One check moves case 53 into group 3; another wants group 3 to have 5 open cases, which the seed already has. 3 of 4. |
| `task_20251210_002938_761_897c3e0b_f075229a` | A check that counts cases by account, product and description also matches a seeded case once the new one is updated after its creation; upstream passes only when both land in the same wall-clock second. 8 of 9. |

Two more tasks (`task_20260101_122222_300_ad5a67e3_3757206c`,
`task_20260102_172945_725_ad5a67e3_5480e26f`) need a case updated after
it was created. They pass here, where the clock moves a second a call,
and as a real agent's run would upstream, but a fast replay of their
solutions on upstream's image often fails them.
