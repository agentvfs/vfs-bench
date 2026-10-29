# Agent-Diff

[agent-diff-bench/agent-diff](https://github.com/agent-diff-bench/agent-diff)
@ `3bb9c40`, MIT. There are 224 tasks against replicas of Box, Slack, Linear
and Google Calendar. Each task is graded on the database diff it leaves.

## Setup

```sh
python3 -I agentdiff/setup.py
```

This does three things:
- Clones upstream into `state/agentdiff/src`.
- Downloads Box's OpenAPI descriptions
  ([box/box-openapi](https://github.com/box/box-openapi) @ `c9a878a`,
  Apache-2.0).
- Builds the backend image that `compose.yaml` runs.

## How it maps

| Upstream | Here |
|---|---|
| The backend, in Docker | The same backend, unchanged, as one compose project per run (`backend.ts`, `compose.yaml`). Postgres is on tmpfs, and the run seeds only its own service. |
| A run's environment, from the SDK | `initEnv` from the task's seed template, impersonating the task's user, then `startRun` |
| The agent calls the HTTP API with `curl` or `requests` | A `box` CLI with one command per operation. It's generated from Box's own OpenAPI description, limited to the operations the replica serves (from its `routes.py`). Box Hubs come from the 2025.0 description, and the CLI sends the `box-version: 2025.0` header it requires. |
| — | Box's files are also mounted at `/box`, against the same replica. Uploads go through it, since the CLI leaves out multipart operations. |
| The ReAct system prompt | The same session and environment lines, with the CLI named where upstream named the API. The XML reply format is left out. |
| The evaluator | `evaluateRun` with the task's expected output, and the run's assertion failures as checks |

## Divergences from upstream

- The agent reaches the API through the generated `box` CLI and the `/box`
  mount, not by writing HTTP calls. `curl` is refused in this workspace.
- The backend's Python dependencies are re-resolved, hashed, in
  `requirements.txt`. Upstream's lock no longer builds on its own
  `python:3.14-slim` image, because psycopg2-binary 2.9.10 fails to build
  there.
- The snapshot is the diff alone. `diffRun`'s snapshot names are per run.
- The grader ignores Box rows' `path` column, as the tasks already ignore
  `path_collection`. `path` holds a row's ancestor ids. Upstream added it
  on 2026-02-11, after the tasks' assertions were written. At the pinned
  commit, every move changes it, so an assertion that allows a move fails
  on a field it never names. Ignoring it grades the diff as it was before
  the column existed.

## Tasks

| Task | Upstream | Service |
|---|---|---|
| `box-crisis-duplicate` | `box_132` | Box |
| `box-typo-ethics` | `box_139` | Box |
| `box-typo-computational` | `box_145` | Box |
| `box-economic-domains` | `box_155` | Box, with Hubs |
| `box-cryptid-expedition` | `box_156` | Box, with Hubs |
| `box-tea-ro-season` | `box_157` | Box, with Hubs |
| `box-minimoog-restoration` | `box_158` | Box, with Hubs |
| `box-conservation-audit` | `box_159` | Box, with Hubs |
| `box-history-archive-cleanup` | `box_160` | Box, with Hubs |
| `box-demographics-hub` | `box_162` | Box, with Hubs |
| `box-earnings-size-audit` | `box_163` | Box, with Hubs |

Slack, Linear and Calendar are not ported yet.
