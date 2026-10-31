# DataSpace

[HKUSTDial/DataSpace](https://github.com/HKUSTDial/DataSpace) @ `6491caa`, code
and data MIT: 46 of its 60 public tasks. No services: the task's context is
mounted read-only at `/workspace` and the answer goes to
`/output/prediction.csv`. Upstream's evaluator runs on Monty (`graders/`).

## Fetch and run

From `vfs-bench-2/`:

```sh
uv run --project datasets/dataspace python -I datasets/dataspace/fetch.py
uv run --project formats/harbor python -I datasets/dataspace/generate.py --check
uv run --project formats/harbor harbor run -c datasets/dataspace/jobs/harbor.yaml -a nop -n 32
uv run --project formats/harbor harbor run -c datasets/dataspace/jobs/oracle.yaml -a oracle -n 32
```

| Upstream | Here |
|---|---|
| The task's `context/`, read-only at `/workspace` | `state/dataspace/benchmark/input/task_N/context`, mounted read-only at `/workspace` in place of the trial's own (`${STATE}` in `workspace.yaml`'s `workspace`, and `replace: [/workspace]`, which `mocks.ts` reads). Nothing is copied or committed |
| The answer at `/output/prediction.csv` | The same; `/output` is a writable mount on the trial's run dir |
| `relation_task_prompt` (contract relation-v2) over the question | `harbor/instruction.md`, verbatim |
| `wall_time_seconds: 1800` | The agent's `timeout_sec` |

## The answer reaches the verifier alone

`jobs/harbor.yaml` selects `MirageVerifier` for all 46 tasks. Harbor freezes
`/output/prediction.csv` plus its file metadata and verifies the source,
config and gold hashes in `graders/manifest.json`. Only those
inputs enter a fresh, read-only RAM VFS. Rewards are written to a separate
writable mount. Neither the gold nor the config is mounted in the agent's
workspace. Grading has no SQLite, Pyodide, VM, network or host Python callback.

`graders/build_manifest.py` generates `graders/port.py` from upstream's
evaluator (`graders/reference/evaluate.py`),
preserving the relation comparison and Decimal arithmetic. Compatibility
modules handle Monty's unsupported exception inheritance, CSV field limits,
UTF-8 BOMs and CPython 3.12 ISO date parsing. The worker memory limit is
512 MiB; it is a cap, not a measurement of per-trial memory usage.

## Results

All eleven tasks with committed oracle solutions pass; all 46 no-op
trials score zero with `missing_prediction`, without retries or exceptions.
At `-n 8`, measured CLI wall time was 12.18 s for the eleven oracles and
24.04 s for all 46 no-op trials (Harbor job time: 9.94 s and 22.25 s).
The remaining 35 tasks have no committed oracle. All 46 gold-as-prediction
cases pass. When the port was made, 681 comparisons against upstream's
evaluator on CPython found zero mismatches: 552 task mutations (column and
row permutations, duplicate rows, BOMs, malformed CSV and UTF-8), 72
normalization, limit and failure cases, and 57 saved Harbor trials. The
unit tests compare 2,009 CSV strings and 1,819 date/time spellings
with CPython, including invalid forms and UTC overflow boundaries.

At `-n 46`, with `MirageVerifier` enabled and retries disabled, measured
results on commit `43ff943` were:

| Workload | Result | CLI wall time | Harbor job time |
|---|---|---:|---:|
| All 46 committed tasks, `-a oracle` | 11 passed; 35 missing solution scripts, so no grading for those 35 | 28.50 s | 26.12 s |
| All 46 tasks with temporary gold-answer oracle scripts | 46 passed; zero errors or retries | 28.68 s | 26.51 s |

The second run is a verifier/infrastructure smoke test: temporary task
copies used `cp /solution/gold-answer.csv /output/prediction.csv`, with
each answer checked against the pinned gold hash. It does not establish
46 analytical oracle solutions. Committed tasks were unchanged.
All 46 verifier phases overlapped; the interval from the first verifier
start to the last verifier finish was 7.12 s. Environment setup spanned
19.16 s. These runs used the default daemon per trial, with separate
Mirage/Monty grading workspaces; they did not use a shared daemon.

## Skipped

The 14 public tasks whose question reads its criteria off
`context/video/briefing.mp4` ("according to the ... shown in the video"):
`task_23`, `task_24`, `task_48`, `task_85`, `task_102`, `task_103`,
`task_111`, `task_159`, `task_300`, `task_312`, `task_328`, `task_378`,
`task_389` and `task_398`. The workspace has no video decoding, frames or
speech recognition, so the answer cannot be found as upstream's workbench
lets a model find it. `generate.py`'s `SKIPPED` lists them.

## Divergences

- **Videos.** 14 committed tasks ship a video their question does not
  name (for example `task_123`, `task_133`); they are kept, and if a
  video holds part of an answer, no agent here can read it.
- **Time.** An agent has upstream's 1,800 s, but each command line
  Mirage's 600 s (`workspace.yaml`).
- **Scratch space.** `TOOLS.md` has the agent write its scripts and
  intermediate files to the output directory; `/output` takes them, and
  `/tmp` too. The evaluator reads `/output/prediction.csv` alone.

