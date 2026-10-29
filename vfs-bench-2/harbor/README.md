# Harbor on Mirage

A [Harbor](https://pypi.org/project/harbor/) (0.25.0) environment that
serves each trial from a Mirage workspace instead of a Docker container.
`harbor run --env vfsbench_harbor:MirageEnvironment` builds nothing. It
reads the task's environment definition, gets the task's services ready,
and creates a workspace on a Mirage daemon of the trial's own. Harbor's
`exec` is the daemon's `/shell`, and its uploads and downloads are copies
into and out of the workspace's mounts.

It runs two kinds of task:
- **Committed tasks**, under `tasks/liveclawbench/`: seven LiveClawBench
  tasks as Harbor task directories. Each has an `environment/mirage.yaml`
  in place of upstream's Dockerfile. Their services are kit fakes on
  Mirage's integ kit, one process per service for the whole job, and each
  trial is a run of its own on each.
- **Upstream task directories**, under `state/liveclawbench/src/tasks/`:
  a task's Dockerfile names its base image, and each trial starts its own
  copy of upstream's Bun mocks. This is how the committed tasks ran first,
  and it still works.

## Run

You need Node 24.15 or later and Bun on `PATH`, and LiveClawBench's setup
done (`python3 -I liveclawbench/setup.py`). From `vfs-bench-2/`:

```sh
uv sync --project harbor
# The committed tasks: upstream's solutions, then doing nothing: 1.0, then less.
uv run --project harbor harbor run -c harbor/liveclawbench.yaml -a oracle -o state/harbor/jobs
uv run --project harbor harbor run -c harbor/liveclawbench.yaml -a nop -o state/harbor/jobs
# In parallel, or one task twice; every trial shares the job's fakes.
uv run --project harbor harbor run -c harbor/liveclawbench.yaml -a oracle -n 4 -o state/harbor/jobs
uv run --project harbor harbor run -p harbor/tasks/liveclawbench/chat-sticker-engagement \
  --env vfsbench_harbor:MirageEnvironment -a oracle -k 2 -n 2 -o state/harbor/jobs
# An upstream task directory, as it is.
uv run --project harbor harbor run -p state/liveclawbench/src/tasks/weather-aqi-report \
  --env vfsbench_harbor:MirageEnvironment -a oracle -o state/harbor/jobs

# A model, with Harbor's dspy-rlm agent (see "Agents" below).
uv sync --project harbor --extra dspy
DENO_NO_PACKAGE_JSON=1 OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_API_BASE=... \
  uv run --project harbor --extra dspy harbor run -c harbor/liveclawbench.yaml \
  -a dspy-rlm -m openai/gpt-5.6-luna -o state/harbor/jobs

# Trials side by side cannot reach each other.
uv run --project harbor python -I harbor/isolation.py [--out <dir>]

# Rewrite the committed tasks from upstream, or check them against it.
uv run --project harbor python -I harbor/export.py [--check]
```

`--ek node=<path>` names the Node binary if `node` on `PATH` is not 24.
Each trial's environment is under `<trial dir>/mirage/`: the generated
`workspace.yaml` and `plan.json`, and the logs of the mocks, the launcher
and the daemon. With `--delete` (the default) its directories go and those
files stay. The shared fakes log into the job's directory, as
`fake-<service>.log` and `fake-<service>.launcher.log`.

The kit fakes' Prisma clients are generated the first time each fake
starts, through `mocks/node_modules`, a gitignored link to Mirage's integ
packages. Each schema gets a client of its own, `mocks/<service>/client-<hash>/`,
and `client` links to the current one, so jobs started together never
remove a client another one is loading. After that, `pnpm exec tsc -p mocks` type-checks the fakes.

## Files

- `src/vfsbench_harbor/environment.py`: `MirageEnvironment`, a client of the
  daemon's HTTP API.
- `src/vfsbench_harbor/fakes.py`: the shared kit fakes, one per service
  for the Harbor process, and each trial's runs of them.
- `fakes.ts`: starts one shared kit fake, with `harness/fakes.ts`.
- `mocks.ts`: one per trial. It lays out the run's directories and writes
  the plan: the workspace config, each mount's host directory, the state
  files, and the routes from upstream's ports to the services. For an
  upstream task it also starts the trial's own mocks.
- `mirage.ts`: the adapter `mocks.ts` reads a committed task with, from its
  `environment/mirage.yaml`.
- `liveclawbench.ts`: the adapter for an upstream task. It reuses
  `liveclawbench/index.ts`'s mock launcher and data layout (`DATA`).
- `preload.ts`: loaded into each trial's daemon. It routes the trial's
  network and stops the daemon when its parent goes.
- `tasks/liveclawbench/<task>/`: the committed tasks.
- `export.py`: writes the committed tasks' upstream files, or checks them.
- `fixtures/`: builds a task's kit fixture from upstream's own seed, under
  Bun.
- `../mocks/chat/`, `../mocks/weather/`: the kit fakes this repo adds, in
  Mirage's integ layout: a Prisma schema, `config.ts`, `fake.ts`,
  `routes.ts`, `wire.ts`, `pages.ts` and `main.ts`.
- `workspace.yaml`: the workspace every trial starts from.
- `liveclawbench.yaml`: the committed tasks, as a Harbor job config.
- `isolation.py`: the isolation check.

## The committed tasks

Each task directory is upstream's at the pinned commit, with
`environment/Dockerfile` replaced by `environment/mirage.yaml`. Its files
are of four kinds, and `export.py` says which is which:

| Kind | Files | Written by |
|---|---|---|
| Verbatim | `task.toml`, `tests/test.sh`, `tests/_seed_snapshots/`, `environment/notes/`; for rule B also `instruction.md`, `solution/solve.sh`, `tests/verify.py` | `export.py`, from upstream |
| Derived | a rule-A `instruction.md`: one phrase changed | `export.py`, from upstream |
| Generated | `environment/fixtures/<service>.json`, the run's seed | `export.py`, from upstream's seed |
| Ours | `environment/mirage.yaml`; a rule-A `solution/solve.sh` and `tests/verify.py` | by hand |

`export.py --check` fails if a verbatim, derived or generated file differs
from what upstream gives, if `mirage.yaml`'s `env`, `copy` and `run`
disagree with upstream's Dockerfile, or if a file is missing or
unaccounted for.

`mirage.yaml` names the task's fakes, each with its fixture, the epoch its
runs' clock is frozen at, the upstream ports that reach it and where its
SQLite is read. It also gives the Dockerfile's `ENV`, `COPY` and `RUN`
(`env`, `copy`, `run`) and the mounts and CLIs the task adds to the
workspace (`workspace`). `mirage.ts`'s header describes each key.

A fixture comes from upstream's own seed (`fixtures/main.ts`). The mock's
seed runs as it is, under Bun, into a scratch SQLite, with `TASK_NAME` set
and the clock frozen at the epoch. The rows it writes become the fixture.

### Rules A and B

**Rule A: Mirage already has the service, so the task uses Mirage's fake.**
The email tasks run on Mirage's gws fake (integ/server/gws, schema
integ/prisma/gws.prisma), its Gmail part. The agent reaches the mailbox the
Mirage way: the `/gmail` mount (`vfs: gmail`) and the `gws` CLI, both at
the trial's run of the fake. These tasks differ from upstream:
- `instruction.md`: only how to reach the mailbox changes.
  "(http://localhost:5174/, open it in browser)" becomes "(at /gmail, or
  through the gws CLI)".
- `solution/solve.sh`: upstream's steps, through the mount and the CLI. It
  finds a message with `grep -l` under `/gmail/INBOX/`, then sends with
  `gws gmail send` or `gws gmail reply`, where upstream's posts to the
  email mock's REST API.
- `tests/verify.py`: every check and weight of upstream's, reading the gws
  run's SQLite in place of the email mock's.
- The seed is upstream's email seed for the task, as Gmail messages:

| Upstream's email mock | Mirage's gws fake |
|---|---|
| a row of `emails` | a `Message`, with its `MessageHeader` and `MessageLabel` rows |
| `folder = 'inbox'` | label `INBOX`, and `UNREAD` where `is_read = 0` |
| `folder = 'sent'` | label `SENT` (and not `TRASH`) |
| the sender's username and email | `From: "<username>" <<email>>` |
| `recipient_email` | `To`, whose addresses verify.py reads |
| `subject`, `body` | `Subject`, `bodyText` |
| `created_at` | `Date` and `internalDate` |

**Rule B: Mirage lacks the service, so it is a new kit fake that keeps
upstream's API.** Chat has stickers, which Mirage's Slack and Discord fakes
lack, and Mirage has no weather service. `mocks/chat` and `mocks/weather`
keep upstream's routes, request and response JSON, pages and auth (none),
with Hono's 404 for anything else. Their Prisma schemas have upstream's
tables and columns (`@@map`), so upstream's `verify.py` runs unchanged on a
run's file. `instruction.md` and `solve.sh` are upstream's too, curl to
`localhost:<port>` included. Against upstream's mock with its clock frozen
at the same epoch, every weather route answers byte for byte the same,
and so does each chat route and page tried, but for sticker file names and
write times (below).

| Task | Rule | Service | Oracle | nop |
|---|---|---|---|---|
| chat-sticker-engagement | B | chat (mocks/chat) | 1.0 | 0.0 |
| sticker-store-acquire | B | chat (mocks/chat) | 1.0 | 0.0 |
| weather-aqi-report | B | weather (mocks/weather) | 1.0 | 0.0 |
| newsletter-digest-forward | A | gws, Mirage's | 1.0 | 0.2 |
| procurement-quote-compare-reply | A | gws, Mirage's | 1.0 | 0.0 |
| stale-client-escalation | A | gws, Mirage's | 1.0 | 0.2 |
| vendor-requirement-followup | A | gws, Mirage's | 1.0 | 0.4 |

The nop scores are upstream's, on both paths.

## Shared fakes

One kit fake per service serves every trial of a job. Harbor runs a job's
trials in one Python process, so `fakes.py` keeps a pool for that process.
The first trial that needs a service starts its fake (`fakes.ts`); later
trials reuse it. The fakes stop when the process exits. A pool the
environment starts lazily works with any `harbor run` as it is. A Harbor
job plugin would need `--plugin` on every command line, since Harbor 0.25
ignores a job config's `plugins` key, and `isolation.py` runs environments
with no job at all.

Each trial is a run of its own on each fake. Its start registers the
task's fixture with the pool, named by task and content, then calls
`POST /reset {"run": <trial>, "fixture": <name>, "epoch": <epoch>}`. The
kit seeds a SQLite file for the run; gws copies it from a template once a
run has used that seed. Its stop calls `DELETE /_kit/runs/<run>`.

The trial reaches its runs as follows:
- `localhost:<upstream port>` goes to `<fake>/_run/<run>/<path>`, so
  upstream's `curl http://localhost:5003/api/stickers` is unchanged.
- A mount or CLI gets the run's base URL in the workspace config
  (`${GWS_URL}` in `mirage.yaml`), as the kit is designed for. Requests
  under it go as they are.
- Everything else is refused: another run's path on the real port, the
  real port outside the trial's runs, and the internet. Under a run, the
  kit's own endpoints (`/reset`, `/_kit/...`) answer 404, as upstream's
  services do.

Each trial keeps a Mirage daemon of its own, as before: curl's routing is
process-global. A run's SQLite is the state file the verifier reads. The
kit keeps it in the rollback journal, not WAL, and the environment copies
it into the trial's read-only mount before each `exec`, as before.

## How it maps

| Harbor on Docker | Here |
|---|---|
| Build `environment/Dockerfile` | Read `environment/mirage.yaml`; for an upstream task, read the Dockerfile. `FROM liveclawbench-<task>-base` names the task; `task-binary-map.json` names its mocks |
| The base image runs the mocks on fixed ports | A committed task's services are the job's shared kit fakes, the trial a run of each. An upstream task's mocks run unchanged under Bun on free ports. Either way `localhost:<upstream port>` and `127.0.0.1:<upstream port>` reach them |
| The mocks' data at `/var/lib/mock-data/...`, `/opt/mock/data/...` | The same paths, mounted read-only, holding a copy of each state file taken before every `exec`. A rule-A task reads its gws run at `/var/lib/mock-data/gws/gws.db` |
| `ENV` | The workspace's `env:`, as written. An upstream task's mocks get it too, with a path under a copied directory pointed at the task's file, and their own data paths pointed into the run |
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

Each trial has its own daemon. A committed task's trials share the job's
fakes, each with runs of its own; an upstream task's trials each have their
own mocks.

| Layer | Per-trial daemon (the default) |
|---|---|
| Workspace | Its own workspace on its own daemon |
| Files | Its mounts are its own run dir; no other host path is visible |
| Services | Its own runs on the shared fakes, each its own SQLite file, clock and ids; or its own mock processes, ports and data |
| Network | Its own routes: its upstream ports reach its own runs or mocks, and its mounts its own runs; every other path and port, another trial's or its own, and the internet are refused |
| CPU | Its own Node process and event loop, Pyodide included; nothing is capped |
| Crash | A daemon that dies ends only its trial. A shared fake that dies fails the trials using it |
| Verifier | Shares the agent's workspace, as Harbor's shared verifier does on Docker |

`isolation.py` starts five trials at once from the committed tasks:
chat-sticker-engagement twice (A and B, on one chat fake), weather-aqi-report
once (C), and stale-client-escalation twice (D and E, on one gws fake). It
checks from inside the workspaces that a trial sees only its own state: on
its data mount, through its API, its `/gmail` mount and the `gws` CLI. It
checks that a trial cannot reach another's run by path through its own URL
(`localhost:5003/_run/b/...` is a 404 in its own run), by the shared fake's
real port, or outside its runs, and cannot reset its run. It also checks
one trial's commands against each other: six at once each see its state,
and a command canceled mid-run (`asyncio.wait_for`) is stopped before it
writes. All 32 checks pass, the 16 it had before the fakes were shared
among them.

`--ek daemon_url=<url>` creates the workspace on a running daemon instead.
That daemon cannot route each workspace to its own mocks: Mirage's curl
fetches through the process's global `fetch`, and nothing in Mirage is
scoped to a workspace. Sharing one daemon needs a per-workspace network
policy in the workspace config, an allowlist with host and port mapping
(`localhost:1235` to `127.0.0.1:53211`) that curl's HTTP layer applies for
the workspace it runs in.

## Upstream tasks

The seven committed tasks pass from their upstream directories too, with
the same nop scores. Of the six cookie-free tasks first picked, three fail
for upstream's reasons:
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

21 of the 102 tasks' solutions log in with a cookie jar: `curl -c <file>`
on the login request, then `-b <file>` on every later one, 6 of them with
`-L`. Mirage's curl keeps the jar as curl does, in a file in the
workspace. The 10 finance tasks among them have mocks with a layout here:
- finance-anomaly-detect, finance-budget-alert, finance-expense-log,
  finance-invoice-process, finance-monthly-close and
  finance-portfolio-rebalancing pass.
- finance-analysis-generate, finance-dashboard-repair,
  finance-depreciation-audit and finance-tax-prepare are refused at start.
  Their Dockerfiles also `COPY policies/ /workspace/policies/`, and only
  `COPY . <dir>` is carried out.

The other 11 need a mock with no layout here (calendar, social, workspace,
expense, insurance or health), and 4 of them a legacy startup script too.

## Divergences and gaps

- **Rule-A tasks.** They are not upstream's: the instruction names the
  mount and the CLI, and the solution and verifier are ours (above). Their
  mailbox is Gmail's: messages, labels and headers, not upstream's email
  app, its REST API (5001) or its frontend (5174). The verifiers keep each
  check, exact address matches included; a sent message's recipients are
  its `To` addresses, as upstream's one `recipient_email` was. Mirage's
  gws fake has no drafts, threads or `messages.modify` (its own README
  lists what it lacks), which these four tasks' checks do not need.
- **Frozen clock.** Upstream's mocks seed relative to the wall clock and
  stamp writes with it. Here a run's clock is frozen at its epoch,
  2026-04-03T09:00:00Z, the date the tasks' solutions write, and moves a
  second per write. The weather mock's "today" is that date in China
  Standard Time, so its reseed when the date changes never happens.
- **Ids.** The chat mock names each sticker file `crypto.randomUUID()`.
  Here a file's name is a UUID-shaped counter of the run's, and the seed's
  are counted too. No verifier reads them.
- **The chat fake's store.** It has one table upstream's has not:
  `_sticker_file`, each sticker's bytes by its `storage_path`, which
  upstream keeps as files. A run is then one file. Prisma cannot state
  upstream's CHECK lists, so the routes enforce them as upstream's
  handlers do, and `PRAGMA table_info` shows each `id` NOT NULL. An
  upload's type is read as Bun reads it: from the file name's extension,
  ignoring the part's Content-Type. The pages are upstream's own
  components (`src/components/*.tsx`), bundled with esbuild and Hono's JSX
  runtime from upstream's checkout; the store's art is read from there too.
- **Kit endpoints.** A shared fake has `/reset` and `/_kit/...`, which
  upstream's mocks lack. The trial's routing answers them 404.
- **Offline.** Every task here asks for the internet (`allow_internet`),
  and gets only its services; the environment logs a warning. The agents
  run on the host, so their model calls are unaffected. The capability
  declared is `disable_internet` alone, and no CPU or memory limits.
- **Time.** An `exec` is one Mirage line, and `workspace.yaml` gives a
  line 300 s (`@line` in `command_limits`). Past that it exits 124
  (`line: timed out after 300s`), however long Harbor's `timeout_sec`.
- **curl.** It lacks `-G/--get` (sending `-d` and `--data-urlencode` as
  the query) and the `-w` variable `%{redirect_url}`.
- **Python.** `python3` is Pyodide. It has no network, so the 15 verifiers
  that query a live service fail that step; weather-aqi-report's falls back
  to the seeded values, as upstream's code does. `zoneinfo` finds no time
  zones, since nothing loads Pyodide's `tzdata` for it (nutrition-log-meal).
  Of the 102, 4 verifiers use `subprocess` and 3 import the email app's
  Flask and SQLAlchemy models, which Pyodide cannot run.
- **State files are copies.** Upstream's mocks keep SQLite in WAL mode,
  open, and Pyodide's SQLite cannot share a WAL with another process (it
  fails with a disk I/O error, and writes a `-shm` beside the live file).
  The kit fakes use the rollback journal. Either way, before each `exec`
  the environment copies each state file into its read-only mount
  (`VACUUM INTO`, then the rollback journal). A command sees the services'
  state as it was when the command started.
- **Not carried over.** The image's assets and frontends (the mocks read
  their assets from upstream's checkout), users, `HEALTHCHECK`, and `RUN` in
  exec form. A `RUN` line Mirage cannot run fails the start, naming it. A
  committed task's `/workspace/environment` holds its `notes/`, not the
  Dockerfile.
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
- **Model run.** dspy-rlm with `openai/gpt-5.6-luna` reached 1.0 on
  weather-aqi-report from its upstream directory: it fetched the mock's
  page with curl through the workspace and wrote the report.
