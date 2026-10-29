# Harbor on Mirage

A [Harbor](https://pypi.org/project/harbor/) (0.25.0) environment that
serves each trial from a Mirage workspace instead of a Docker container.
`harbor run --env vfsbench_harbor:MirageEnvironment` builds nothing. It
reads the task's environment definition, starts the task's mocks as local
processes, and creates a workspace on a Mirage daemon of the trial's own.
Harbor's `exec` is the daemon's `/shell`, and its uploads and downloads
are copies into and out of the workspace's mounts.

Harbor, and upstream's `instruction.md`, `solution/solve.sh`,
`tests/test.sh` and `tests/verify.py`, all run unchanged. The tasks run
from upstream's own directories under `state/liveclawbench/src/tasks/`.
Only LiveClawBench is supported so far.

## Run

You need Node 24.15 or later and Bun on `PATH`, and LiveClawBench's setup
done (`python3 -I liveclawbench/setup.py`). From `vfs-bench-2/`:

```sh
uv sync --project harbor
# Upstream's solutions, then doing nothing: 1.0, then less.
uv run --project harbor harbor run -c harbor/liveclawbench.yaml -a oracle -o state/harbor/jobs
uv run --project harbor harbor run -c harbor/liveclawbench.yaml -a nop -o state/harbor/jobs
# One task: -p <upstream task dir> --env vfsbench_harbor:MirageEnvironment.

# A model, with Harbor's dspy-rlm agent (see "Agents" below).
uv sync --project harbor --extra dspy
DENO_NO_PACKAGE_JSON=1 OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_API_BASE=... \
  uv run --project harbor --extra dspy harbor run -c harbor/liveclawbench.yaml \
  -a dspy-rlm -m openai/gpt-5.6-luna -o state/harbor/jobs

# Trials side by side cannot reach each other.
uv run --project harbor python -I harbor/isolation.py
```

`--ek node=<path>` names the Node binary if `node` on `PATH` is not 24.
Each trial's environment is under `<trial dir>/mirage/`: the generated
`workspace.yaml` and `plan.json`, and the logs of the mocks, the launcher
and the daemon. With `--delete` (the default) its directories go and those
files stay.

## Files

- `src/vfsbench_harbor/environment.py`: `MirageEnvironment`, a client of the
  daemon's HTTP API.
- `mocks.ts`: one per trial. It starts the task's mocks with
  `harness/fakes.ts`, lays out the run's directories and writes the plan:
  the workspace config, each mount's host directory, the mocks' state files
  and the routes from upstream's ports to the mocks.
- `liveclawbench.ts`: the adapter `mocks.ts` reads a task with. It reuses
  `liveclawbench/index.ts`'s mock launcher and data layout (`DATA`).
- `preload.ts`: loaded into each trial's daemon. It routes the trial's
  network and stops the daemon when its parent goes.
- `workspace.yaml`: the workspace every trial starts from.
- `liveclawbench.yaml`: the tasks that run, as a Harbor job config.
- `isolation.py`: the isolation check.

## How it maps

| Harbor on Docker | Here |
|---|---|
| Build `environment/Dockerfile` | Read it. `FROM liveclawbench-<task>-base` names the task; `task-binary-map.json` names its mocks |
| The base image runs the mocks on fixed ports | Each mock runs unchanged under Bun on a free port. `localhost:<upstream port>` and `127.0.0.1:<upstream port>` reach it |
| The mocks' data at `/var/lib/mock-data/...`, `/opt/mock/data/...` | The same paths, mounted read-only, holding a copy of each state file taken before every `exec` |
| `ENV` | The workspace's `env:`, as written. The mocks get it too, with a path under a copied directory pointed at the task's file, and their own data paths pointed into the run |
| `COPY . <dir>`, `RUN`, `WORKDIR` | The task's `environment/` copied in; each `RUN` line run in the workspace once it opens, in its `WORKDIR` |
| `exec` | `POST /v1/workspaces/:id/shell?background=true`, then `POST /v1/jobs/:id/wait` |
| `/workspace`, `/logs`, `/tests`, `/solution`, `/tmp` | Disk mounts on directories under the trial's run dir |
| `upload_*`, `download_*` | Copies into and out of those directories |
| `python3` | Pyodide, from `setup/python.py`'s bundle |
| The container's users | None. `user` changes nothing |

Mirage revalidates each mount's listings against its folder (`read: fresh`),
since the host writes them too. Every `exec` runs in a session of its own,
as `docker exec` does, so `cd` and `export` do not carry over.

## Isolation

Each trial has its own daemon and its own mock processes.

| Layer | Per-trial daemon (the default) |
|---|---|
| Workspace | Its own workspace on its own daemon |
| Files | Its mounts are its own run dir; no other host path is visible |
| Mocks | Its own processes, ports and data |
| Network | Its own routes: its upstream ports reach its own mocks; every real port, another trial's or its own, and the internet are refused |
| CPU | Its own Node process and event loop, Pyodide included; nothing is capped |
| Crash | A daemon or mock that dies ends only its trial |
| Verifier | Shares the agent's workspace, as Harbor's shared verifier does on Docker |

`isolation.py` starts three trials at once (chat-sticker-engagement twice,
weather-aqi-report once) and checks this from inside the workspaces. It
also checks one trial's commands against each other: six at once each see
its state, and a command canceled mid-run (`asyncio.wait_for`) is stopped
before it writes. All 16 checks pass. Harbor's own `-k 2 -n 2` over one
task runs two daemons and two mock sets side by side, and both trials pass.

`--ek daemon_url=<url>` creates the workspace on a running daemon instead.
That daemon cannot route each workspace to its own mocks: Mirage's curl
fetches through the process's global `fetch`, and nothing in Mirage is
scoped to a workspace. Sharing one daemon needs a per-workspace network
policy in the workspace config, an allowlist with host and port mapping
(`localhost:1235` to `127.0.0.1:53211`) that curl's HTTP layer applies for
the workspace it runs in.

## Tasks

Seven tasks reach 1.0 with the oracle, and less with nop:

| Task | Mocks | nop |
|---|---|---|
| chat-sticker-engagement | chat | 0.0 |
| sticker-store-acquire | chat | 0.0 |
| weather-aqi-report | weather | 0.0 |
| newsletter-digest-forward | email | 0.2 |
| procurement-quote-compare-reply | email | 0.0 |
| stale-client-escalation | email | 0.2 |
| vendor-requirement-followup | email | 0.4 |

Of the six cookie-free tasks first picked, three fail for upstream's
reasons:
- mint-diet-snack-log, nutrition-log-meal and mint-diet-comprehensive: the
  mint-diet mock registers its form routes (`POST /log/<date>/entries`,
  `POST /plans`) with `app.page`, which mock-lib registers as GET only, so
  the solutions' POSTs get 404, as they would in upstream's image.
- mint-diet-comprehensive also uses `curl -G` and `-w '%{redirect_url}'`,
  which Mirage's curl lacks. Its verifier writes non-numeric fields to
  `reward.json`, which Harbor refuses (`VerifierOutputParseError`).
- nutrition-log-meal's verifier needs `zoneinfo` data (below).

Of the 102 tasks on a per-task image, 61 need a mock with no layout here
(social, calendar, airline and others), and 7 a legacy startup script; both
are refused at start. 36 tasks' solutions run `openclaw agent`, the image's
own model agent, so they have no scripted oracle. weather-city-travel-pick
and weather-outdoor-window fetch from Python, which has no network here.

## Divergences and gaps

- **Offline.** Every task here asks for the internet (`allow_internet`),
  and gets only its mocks; the environment logs a warning. The agents run
  on the host, so their model calls are unaffected. The capability
  declared is `disable_internet` alone, and no CPU or memory limits.
- **Cookies.** Mirage's curl has no cookie engine. 20 of the 102 tasks'
  solutions log in with one: `-c <file>` on the login request, then
  `-b <file>` on every later one, 6 of them with `-L`. They need curl's
  `-c/--cookie-jar <file>`, writing each response's `Set-Cookie` (each hop
  of a redirect included) to the file in curl's Netscape cookie-file
  format, through the workspace's files; and `-b/--cookie <file>`, sending
  the jar's cookies that match the request's host, path and scheme and have
  not expired, on each hop too. `-b name=value` is sent as is.
- **Other curl gaps.** `-G/--get` (sending `-d` and `--data-urlencode` as
  the query) and the `-w` variable `%{redirect_url}`.
- **Shell.** Under `set -o pipefail`, in `a | b | c || d` with `a` failing,
  Mirage never runs `d`, and with `set -e` the line exits 1; bash runs `d`.
  Two-stage pipelines are right. Upstream's `test.sh`
  (`grep | tail | grep || echo 0`) hits it only when the verifier prints no
  score, and then writes no reward.
- **Python.** `python3` is Pyodide. It has no network, so the 15 verifiers
  that query a live service fail that step; weather-aqi-report's falls back
  to the seeded values, as upstream's code does. `zoneinfo` finds no time
  zones, since nothing loads Pyodide's `tzdata` for it (nutrition-log-meal).
  Of the 102, 4 verifiers use `subprocess` and 3 import the email app's
  Flask and SQLAlchemy models, which Pyodide cannot run.
- **State files are copies.** The mocks keep SQLite in WAL mode, open, and
  Pyodide's SQLite cannot share a WAL with another process (it fails with a
  disk I/O error, and writes a `-shm` beside the live file). So before each
  `exec` the environment copies each state file into its read-only mount
  (`VACUUM INTO`, then the rollback journal). A command sees the mocks'
  state as it was when the command started.
- **Not carried over.** The image's assets and frontends (the mocks read
  their assets from upstream's checkout), users, `HEALTHCHECK`, and `RUN` in
  exec form. A `RUN` line Mirage cannot run fails the start, naming it.
- **Agents.** Agents that install into the container (claude-code, codex)
  cannot run. terminus-2 drives tmux inside the environment, and Mirage has
  none, so its setup fails (`tmux: command not found`). Harbor's dspy-rlm
  runs on the host and uses `exec` alone. Harbor 0.25.0 passes it
  `max_iterations`, which dspy renamed in 3.3, so the `dspy` extra pins
  dspy 3.2.1. Its sandbox is Deno running Pyodide; `DENO_NO_PACKAGE_JSON=1`
  stops Deno taking `vfs-bench-2/package.json` as its project, which makes
  it look for Pyodide in `node_modules`.
- **The daemon.** Its API covered creating the workspace (`POST
  /v1/workspaces`, with the config's `env:` block), running lines (`/shell`
  with `cwd` and `background`, `/v1/jobs/:id/wait` with `timeout_s`, and
  `DELETE /v1/jobs/:id` to cancel), `/close` and `/v1/shutdown`, as is. It
  lacked a per-call environment on `/shell` (the environment exports it
  ahead of the line), a timeout on `/shell` (hence background and wait), a
  free port with a ready line (the client picks the port), and any
  per-workspace network. Setup does not build the server package, so the
  daemon runs from source with `--experimental-transform-types`. File
  transfer uses the disk mounts, not `/vfs`, which a daemon on another host
  would need. `/ssh` and `/codex-exec` are left for later.
- **Model run.** dspy-rlm with `openai/gpt-5.6-luna` reaches 1.0 on
  weather-aqi-report: it fetched the mock's page with curl through the
  workspace and wrote the report.
