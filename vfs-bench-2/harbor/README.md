# Harbor on Mirage

A [Harbor](https://pypi.org/project/harbor/) (0.25.0) environment that
serves each trial from a Mirage workspace instead of a Docker container.
`harbor run --env vfsbench_harbor:MirageEnvironment` builds nothing. It
reads the task's environment definition, gets the task's services ready,
and creates a workspace on a Mirage daemon of the trial's own. Harbor's
`exec` is the daemon's `/shell`, and its uploads and downloads are copies
into and out of the workspace's mounts.

It runs two kinds of task:
- **Committed tasks**, under `tasks/liveclawbench/`: eighteen LiveClawBench
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

# Each verifier in a microVM of its own, with real CPython (see below).
uv run --project harbor harbor run -c harbor/liveclawbench-msb.yaml -a oracle -n 18 -o state/harbor/jobs
uv run --project harbor harbor run -p state/liveclawbench/src/tasks/weather-aqi-report \
  --env vfsbench_harbor:MirageEnvironment --verifier vfsbench_harbor:MicrosandboxVerifier \
  -a oracle -o state/harbor/jobs

# Trials side by side cannot reach each other; --msb checks their verifier VMs too.
uv run --project harbor python -I harbor/isolation.py [--out <dir>] [--msb]

# Rewrite the committed tasks from upstream, or check them against it.
uv run --project harbor python -I harbor/export.py [--check]
uv run --project harbor python -I harbor/test_export.py

# The finance fake against upstream's finance mock (Bun): exits 1 on an
# unexpected difference.
node harbor/compare.ts [task ...]
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
- `src/vfsbench_harbor/microsandbox.py`: `MicrosandboxVerifier`, which runs
  a trial's verifier in a microVM, and the host's proxies for it.
- `src/vfsbench_harbor/guest.py`: run inside that VM. It relays the
  upstream ports and runs `test.sh`.
- `fakes.ts`: starts one shared kit fake, with `harness/fakes.ts`.
- `mocks.ts`: one per trial. It lays out the run's directories and writes
  the plan: the workspace config, each mount's host directory, the state
  files, and the routes from upstream's ports to the services. For an
  upstream task it also starts the trial's own mocks.
- `copies.ts`: a task's `COPY` lines as both adapters read them, in order,
  and how `mocks.ts` lays them out and maps an `ENV` path a mock reads
  through them (`copies.test.ts`, in `pnpm test`).
- `compare.ts`: the finance fake against upstream's finance mock.
- `mirage.ts`: the adapter `mocks.ts` reads a committed task with, from its
  `environment/mirage.yaml`.
- `liveclawbench.ts`: the adapter for an upstream task. It reuses
  `liveclawbench/index.ts`'s mock launcher and data layout (`DATA`).
- `preload.ts`: loaded into each trial's daemon. It routes the trial's
  network and stops the daemon when its parent goes.
- `tasks/liveclawbench/<task>/`: the committed tasks.
- `export.py`: writes the committed tasks' upstream files, or checks them;
  `test_export.py` tests its check of `copy`.
- `fixtures/`: builds a task's kit fixture from upstream's own seed, under
  Bun.
- `../mocks/chat/`, `../mocks/weather/`, `../mocks/finance/`: the kit fakes
  this repo adds, in Mirage's integ layout: a Prisma schema, `config.ts`,
  `fake.ts`, `routes.ts`, `wire.ts`, `pages.ts` and `main.ts`, and for
  finance `session.ts`, its cookie login.
- `workspace.yaml`: the workspace every trial starts from.
- `liveclawbench.yaml`: the committed tasks, as a Harbor job config.
- `liveclawbench-msb.yaml`: the same, each verifier in a microVM.
- `isolation.py`: the isolation check.

## The committed tasks

Each task directory is upstream's at the pinned commit, with
`environment/Dockerfile` replaced by `environment/mirage.yaml`. Its files
are of four kinds, and `export.py` says which is which:

| Kind | Files | Written by |
|---|---|---|
| Verbatim | `task.toml`, `tests/test.sh`, `tests/_seed_snapshots/`, the rest of `environment/` (`notes/`, `policies/`, `seed.sql`); for rule B also `instruction.md`, `solution/solve.sh`, `tests/verify.py`; a rule-A `tests/verify.py` that reads no mail (`VERBATIM_A`) | `export.py`, from upstream |
| Derived | a rule-A `instruction.md`: how the mailbox is reached changed | `export.py`, from upstream |
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
workspace (`workspace`). `copy` takes `COPY . <dir>` as the entries of
`environment/` it copies, and `COPY <src> <dest>` as its source, relative
to `environment/` (`/workspace/policies: policies/`). Several COPYs to one
destination are a list of them in the Dockerfile's order (`- {src:
policies/}`, `- {src: ., entries: [notes]}`), each merged into what the
ones before left, as Docker does. Destinations are laid out in the order
`copy` lists them, and a file copied onto a directory already there goes
inside it. export.py fails a `copy` that names a destination twice, states
fewer COPYs than the Dockerfile has, lists destinations in another order,
or drops a file's destination `/`; and a Dockerfile whose COPYs to one
destination have another between them, which `copy` cannot state.
`mirage.ts`'s header describes each key.

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
  through the gws CLI)". The finance tasks phrase it their own way, each
  rewritten in `export.py`'s `MAILBOXES`: the email system's URL and
  login become "at /gmail, or through the gws CLI", and an API reference's
  section on the email mock's REST API (login, `GET /api/emails`, `POST
  /api/emails`) becomes its heading alone, "### Email System (at /gmail, or
  through the gws CLI)". finance-budget-shift's instruction never names
  the mailbox and stays upstream's.
- `solution/solve.sh`: upstream's steps, through the mount and the CLI. It
  finds a message with `grep -l` under `/gmail/INBOX/`, then sends with
  `gws gmail send` or `gws gmail reply`, where upstream's posts to the
  email mock's REST API.
- `tests/verify.py`: every check and weight of upstream's, reading the gws
  run's SQLite in place of the email mock's. A finance task's finance
  checks are upstream's as they are, and finance-invoice-process's and
  finance-budget-shift's verifiers, which read no mail, are upstream's
  files (`VERBATIM_A`).
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
lack, and Mirage has no weather or finance service. `mocks/chat`,
`mocks/weather` and `mocks/finance` keep upstream's routes, request and
response JSON, pages and auth (none, or finance's cookie login), with
Hono's 404 for anything else. Their Prisma schemas have upstream's
tables and columns (`@@map`), so upstream's `verify.py` runs unchanged on a
run's file. `instruction.md` and `solve.sh` are upstream's too, curl to
`localhost:<port>` included. Against upstream's mock with its clock frozen
at the same epoch, every weather route answers byte for byte the same,
and so does each chat route and page tried, but for sticker file names and
write times (below).

The finance fake keeps upstream's login as it is. `POST /api/auth/login`
answers `Set-Cookie: token=<JWT>; Max-Age=3600; Path=/; HttpOnly; Secure;
SameSite=Strict`, an HS256 token of `{userId, role, iat, exp}`, which the
solutions keep with `curl -c <jar>` and send back with `-b <jar>`. Every
route but the health check, the probe, login, logout, `/` and `/login`
answers 401 without it (`Authentication required`) or with a bad one
(`Invalid or expired token`), in the order upstream's middleware does: on a
path with no parameter the session, then the body's type (415), then zod's
validation (400); on a path with one, validation, the type, then the
session. Validation messages are zod 3's, in mock-lib's envelope. Its pages
are upstream's components (`src/pages/*.tsx`), bundled with esbuild as the
chat's are, over the rows upstream's `index.tsx` hands them.
`compare.ts` checks the fake against upstream's mock. It runs upstream's
mock as an upstream task directory does (`liveclawbench.ts`'s plan: Bun,
its own seed and the task's seed SQL), with `fixtures/frozen.ts` freezing
`Date` and SQLite's `datetime('now')` at the epoch, and resets a run of the
fake from the task's committed fixture. It sends both the same 139
requests for each of the 11 tasks, compares status, type, location,
`Set-Cookie` and body, then the tables each leaves behind, and exits 1 on
any difference but the two known ones below. The requests are every
route, page and login case, the solutions' requests, validation failures,
type and body edge cases, and a write of every kind. 128 answer byte for byte the same in
every task but finance-budget-shift, 127 there. The others differ only
where the clock does: a write's `created_at`/`updated_at` (in
finance-budget-shift also the rows its fault rewrites), and a later login's
`iat`/`exp`, a second per write after the epoch here and the epoch itself
there. Each token's signature differs too, as two processes' secrets do.
The tables each leaves behind are the same but for those times and the
password hashes' salts.

| Task | Rule | Service | Oracle | nop |
|---|---|---|---|---|
| chat-sticker-engagement | B | chat (mocks/chat) | 1.0 | 0.0 |
| sticker-store-acquire | B | chat (mocks/chat) | 1.0 | 0.0 |
| weather-aqi-report | B | weather (mocks/weather) | 1.0 | 0.0 |
| newsletter-digest-forward | A | gws, Mirage's | 1.0 | 0.2 |
| procurement-quote-compare-reply | A | gws, Mirage's | 1.0 | 0.0 |
| stale-client-escalation | A | gws, Mirage's | 1.0 | 0.2 |
| vendor-requirement-followup | A | gws, Mirage's | 1.0 | 0.4 |
| finance-anomaly-detect | B | finance (mocks/finance) | 1.0 | 0.0 |
| finance-dashboard-repair | B | finance (mocks/finance) | 1.0 | 0.0 |
| finance-depreciation-audit | B | finance (mocks/finance) | 1.0 | 0.0 |
| finance-expense-log | B | finance (mocks/finance) | 1.0 | 0.0 |
| finance-monthly-close | B | finance (mocks/finance) | 1.0 | 0.0 |
| finance-portfolio-rebalancing | B | finance (mocks/finance) | 1.0 | 0.0 |
| finance-analysis-generate | A, B | gws, finance | 1.0 | 0.0 |
| finance-budget-alert | A, B | gws, finance | 1.0 | 0.0 |
| finance-invoice-process | A, B | gws, finance | 1.0 | 0.0 |
| finance-tax-prepare | A, B | gws, finance | 1.0 | 0.2 |
| finance-budget-shift | A, B | gws, finance | 1.0 | 0.0 |

The nop scores are upstream's, on both paths. finance-budget-shift's oracle
is ours: upstream's `solve.sh` runs `openclaw agent`, the image's own model
agent. Ours logs in, reads March's records, sets Marketing's alert at 80%
of its budget (`POST /api/departments/budget-alerts`) and checks the
reply. That first alert is upstream's C1 fault for the task: it also fixes
Sales' negative expense and lowers the HR, Finance and Operations budgets,
which the verifier expects.

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
| `COPY <src> <dest>`, `RUN`, `WORKDIR` | The source under the task's `environment/` copied in (all of it for `COPY .`); each `RUN` line run in the workspace once it opens, in its `WORKDIR` |
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
| Verifier | Shares the agent's workspace, as Harbor's shared verifier does on Docker; or, with `MicrosandboxVerifier`, a microVM of its own (below) |

`isolation.py` starts seven trials at once from the committed tasks:
chat-sticker-engagement twice (A and B, on one chat fake), weather-aqi-report
once (C), stale-client-escalation twice (D and E, on one gws fake), and
finance-anomaly-detect twice (F and G, on one finance fake). It checks from
inside the workspaces that a trial sees only its own state: on its data
mount, through its API, its `/gmail` mount and the `gws` CLI. It checks
that a trial cannot reach another's run by path through its own URL
(`localhost:5003/_run/b/...` is a 404 in its own run), by the shared fake's
real port, or outside its runs, and cannot reset its run. F and G each log
in with a cookie jar; each refuses the other's session cookie (`Invalid or
expired token`) and takes its own. It also checks one trial's commands
against each other: six at once each see its state, and a command canceled
mid-run (`asyncio.wait_for`) is stopped before it writes. All 45 checks
pass, the 16 it had before the fakes were shared among them.

`--ek daemon_url=<url>` creates the workspace on a running daemon instead.
That daemon cannot route each workspace to its own mocks: Mirage's curl
fetches through the process's global `fetch`, and nothing in Mirage is
scoped to a workspace. Sharing one daemon needs a per-workspace network
policy in the workspace config, an allowlist with host and port mapping
(`localhost:1235` to `127.0.0.1:53211`) that curl's HTTP layer applies for
the workspace it runs in.

## The verifier in a microVM

`harbor/liveclawbench-msb.yaml`, or `--verifier
vfsbench_harbor:MicrosandboxVerifier` on any run, verifies each trial
outside its workspace, in a microVM of its own. microsandbox's `msb`
(0.5.10) boots it from `python:3.12-slim-bookworm`, so `test.sh` gets
CPython 3.12 and what Pyodide lacks: a network to the trial's services,
`subprocess` and time zones. The agent's side is unchanged. You need `msb`
on `PATH` or at `~/.local/bin/msb` (`--verifier-kwarg msb=<path>` names
another). The image is pulled once per job.

It is Harbor's verifier with another place to run. Harbor calls it as it
calls its own, with the trial's environment still up:

1. It uploads `tests/` into the workspace's `/tests` and removes stale
   rewards, as Harbor's does.
2. The environment refreshes its copies of the services' state files.
3. It starts a proxy for each upstream port the trial reaches on localhost,
   each on a free port of the host's loopback.
4. It creates a VM with each of the workspace's disk mounts copied in at
   its own path, and a network that reaches those proxy ports alone.
5. In the VM, `guest.py` listens on each upstream port, relays each
   connection to its proxy, and runs Harbor's command for `test.sh` with
   the container's `ENV` and the task's verifier environment. Then it
   writes `/logs/verifier` out as a tar.
6. It removes the VM, however the verification ended, puts that tar's
   files in the trial's verifier directory, and parses the reward as
   Harbor's own does.

| Docker's shared verifier | Here |
|---|---|
| `test.sh` in the agent's container | `test.sh` in a VM booted for the trial; the agent's workspace is left as it is |
| The container's files | Copies of each disk mount (`/workspace`, `/logs`, `/tests`, `/solution`, `/tmp`, the services' data at `/var/lib/mock-data/...` and `/opt/mock/data/...`), taken when verifying starts. Nothing on the host is mounted |
| The mocks on `localhost:<port>` | `localhost:<upstream port>` in the VM, relayed to the trial's proxy on the host, which sends each request to the trial's route: its run of a shared fake (`<fake>/_run/<run>`) or its own mock |
| The container's network | `--no-net`, and `--net-rule allow@host:tcp:<proxy port>` for each route; a task with no routes has no network |
| `python3` | CPython 3.12, the image's, with its standard library and time zones |
| `ENV`, `[verifier.env]` | The workspace's `env:`, then the task's verifier environment as Harbor resolves it |
| The container's CPUs and memory | The task's `cpus`, `memory_mb` and `storage_mb`; `--verifier-kwarg memory_mb=512` and so on change them |
| `/logs/verifier` | Read back as a tar, its regular files only |
| The verifier's timeout | Harbor's; the VM is removed when it fires, on cancel, and on `SIGTERM` |

The proxy is to the VM what `preload.ts` is to the workspace. It reads
each request with h11 and sends it on with httpx, never as raw bytes, so a
request reaches a fake only under the trial's run. It first reads the
path as a URL parser reads an http URL's: a backslash is a slash, `%2e` a
dot, and dot segments resolve. So `/../_run/b` and `/..\..\_run/b` stay in
the trial's run. The fake's own parser would otherwise resolve them after
the run's prefix, and they would reach another run. The kit's endpoints
(`/reset`, `/_kit/...`) answer 404. Each trial's `mirage/verifier.log`
has the VM's attempts, its timings and peak memory, and every request its
proxies passed.

### Why a verifier, not Harbor's separate mode

Harbor 0.25 can run the verifier in an environment of its own
(`environment_mode = "separate"`). It does not fit here:
- It is set in `task.toml`, which `export.py --check` keeps byte for byte
  as upstream's. A verifier is chosen by the job (`verifier.import_path`).
- Harbor builds that environment from the job's environment config, so it
  would be another Mirage workspace, with Pyodide again.
- It stops the agent's environment before the verifier starts. That drops
  the trial's runs on the shared fakes and its own mocks, so a verifier
  that queries a service has nothing to query, and the state files would
  have to be declared artifacts to reach it.

A custom verifier runs where Harbor's shared verifier runs, with the
environment still up, and no task changes.

### Results

At `-n 7` the committed tasks score as they do on Pyodide: the oracle 1.0
on all seven, and nop 0.0, 0.0, 0.0, 0.2, 0.0, 0.2 and 0.4, in the order of
the table above.

Three upstream task directories, run with a curl solution of ours in place
of upstream's Python one (kept out of the repo):

| Task | Its verifier needs | Pyodide: oracle, nop | microVM: oracle, nop |
|---|---|---|---|
| nutrition-log-meal | `zoneinfo` | no reward, no reward | 1.0, 0.0 |
| weather-outdoor-window | the weather mock, over HTTP | 1.0, 0.0, from its fallback | 1.0, 0.0, from the trial's mock |
| weather-city-travel-pick | the weather mock, over HTTP | refused | refused |

- nutrition-log-meal reads today's date in `ZoneInfo(TZ)`. Pyodide has no
  time zones, so its fallback to UTC raises too (`ZoneInfoNotFoundError`),
  and `test.sh` writes no reward. Our solution logs lunch through the
  mint-diet mock's JSON API (`POST /api/log/<date>/entries`), since
  upstream's posts to a form route that answers GET only.
- weather-outdoor-window's verifier cannot reach the mock on Pyodide and
  falls back to values it carries, which are the seed's, so the score is
  the same. In the VM it reads the trial's mock (`GET
  /location/shanghai/hourly -> 200` in its log).
- weather-city-travel-pick's verifier reads the trial's mock in the VM (11
  requests), then writes a string to `reward.json` (`_meta_city_got`),
  which Harbor refuses (`VerifierOutputParseError`) wherever it runs, as
  with mint-diet-comprehensive.

### Overheads

On an Apple silicon Mac (14 cores, 48 GB), with msb 0.5.10: 27 trials of
the committed tasks at `-n 7` (one retried after a hang, below, is left
out), 7 at `-n 1`, and 14 on Pyodide at `-n 7`.

| | `-n 7`, median (max) | `-n 1`, median |
|---|---|---|
| Harbor's verify step, in a microVM | 1.03 s (1.19) | 0.77 s |
| Harbor's verify step, on Pyodide | 1.22 s (1.33) | |
| Boot: create with the copies | 0.31 s (0.40) | 0.23 s |
| `guest.py`: `test.sh`, then the tar of `/logs/verifier` | 0.60 s (0.74) | 0.47 s |
| Removing the VM | 0.07 s (0.11) | 0.06 s |
| Peak host memory, a 4 GiB VM | 198 MiB (199) | 197 MiB |
| Peak host memory, a 2 GiB VM (weather) | 84 MiB (85) | 85 MiB |

The memory is mostly the VM's own, and grows with its size: a 512 MiB VM
(`--verifier-kwarg memory_mb=512`) peaks near 45 MiB, and all seven still
score 1.0 in it. Copying in costs little: a 300 MB workspace of 3,000
files boots in 0.5 s. A job of the seven at `-n 7` takes about 10 s, as on
Pyodide.

msb 0.5.10 now and then hangs. A create never returns: 2 of 175 in a
stress test, concurrent or one at a time, and 1 of about 125 in the jobs
here. Or a running VM leaves a command unrun, and every later one: once in
`isolation.py`'s runs. Both are caught before `test.sh` starts. A create
has 30 s (it takes a third of one), and `guest.py`'s first line,
`STARTED`, has 15 s to come. Past either, the VM is removed and the
verification starts again in a new one, up to three times, so a hang
costs 15 to 30 s. Once `STARTED` has come, a hang cannot be told from a
slow test, and Harbor's timeout ends it.

### Isolation

`isolation.py --msb` adds 37 checks to the 32: after those, it boots the
five trials' verifier VMs at once, as the verifier boots them, and checks
from inside them. A VM that hangs is booted again, as the verifier does,
and the output notes it. All 69 pass:
- Each VM is its own, runs CPython with time zones, and has its own
  trial's state: A's pack in its chat copy, D's mail in its gws copy; B and
  E do not have them.
- A and B each reach their own run at `localhost:5003`, and C its weather
  run at `localhost:3000`; C has no port 5003.
- A cannot reach B's run by path through its own URL, nor with dot
  segments, plain, encoded or with backslashes. It cannot reset its run,
  reach the kit's endpoints, or reach them with `%XX` or a doubled slash.
  Each is a 404 in its own run. Without the backslash rule, A read B's
  run.
- A reaches its own proxy on the host, but not B's or C's, the shared chat
  and gws fakes' real ports, its Mirage daemon's port, a port on its own
  loopback, or the internet by name or address. D, with no routes,
  reaches neither the host nor the internet.
- A's writes to `/workspace`, `/tmp` and `/logs/verifier` are its own:
  B, up at the same time, does not see them, and they do not reach A's
  files on the host. No host run directory is visible inside.
- Every VM is gone from `msb ls` afterwards.

### Gaps

- **Packages.** The image has Python's standard library alone. Upstream's
  verifiers that need more need an image with it (`--verifier-kwarg
  image=<image>`): the 13 that import the email app's Flask and SQLAlchemy
  models, the 25 that use `subprocess` to run git, pytest and the like,
  and one that imports grpc. None of their tasks starts here yet (their
  mocks or `RUN` lines are refused), so none was tried.
- **LLM judges.** 21 tasks' verifiers call a model's API, which the VM
  cannot reach. That needs a rule for the API's host (`--net-rule
  allow@<host>:tcp:443`) and the key, which msb's `--secret` can keep out
  of the guest.
- **Copies.** The VM sees the trial's files as they were when verifying
  started, and only `/logs/verifier` comes back; on Docker the shared
  verifier writes into the agent's container. msb's copies all have the
  time 1970-01-01. `/tmp` in the VM is a 128 MiB tmpfs, filled from the
  trial's before `test.sh` starts.
- **Network.** The proxies speak HTTP/1.1 and buffer each body. HTTPS,
  upgrades and other protocols on an upstream port are not carried. The
  guest's IPv6 gateway reaches the host's `::1`, where no proxy listens,
  so the relay dials the IPv4 one.
- **Users.** `test.sh` runs as root, whatever `[verifier] user` says, as
  `exec` ignores `user` in the workspace.
- **A Harbor that dies.** After a `SIGKILL` the VM lives on until its
  `--max-duration`, four times the task's verifier timeout and ten minutes
  more. Then it stops, but `msb ls` lists it until `msb rm`.
- **msb's stdin and output.** `msb exec` hangs while its stdin is an open
  pipe or socket, so every call gives it `/dev/null`. Without `--stream`
  it holds all output until the command ends, so `STARTED` needs it.
- **Hosts.** Tried on macOS on Apple silicon only. On Linux, msb needs
  KVM.

## Upstream tasks

The committed tasks pass from their upstream directories too, with the
same nop scores, but for finance-budget-shift, whose upstream solution runs
a model (below). Of the six cookie-free tasks first picked, three fail
for upstream's reasons:
- mint-diet-snack-log, nutrition-log-meal and mint-diet-comprehensive: the
  mint-diet mock registers its form routes (`POST /log/<date>/entries`,
  `POST /plans`) with `app.page`, which mock-lib registers as GET only, so
  the solutions' POSTs get 404, as they would in upstream's image.
- mint-diet-comprehensive also uses `curl -G` and `-w '%{redirect_url}'`,
  which Mirage's curl lacks. Its verifier writes non-numeric fields to
  `reward.json`, which Harbor refuses (`VerifierOutputParseError`).
- nutrition-log-meal's verifier needs `zoneinfo` data (below). In a
  microVM it verifies (above).

Of the 102 tasks on a per-task image, 37 need a mock with no layout here
(social, calendar, airline and others), and 7 a legacy startup script; both
are refused at start. 29 use no mock at all. 36 tasks' solutions run `openclaw agent`, the image's
own model agent, so they have no scripted oracle. weather-city-travel-pick
and weather-outdoor-window's solutions fetch from Python, which has no
network here; their verifiers do too, and in a microVM they reach the mock
(above).

21 of the 102 tasks' solutions log in with a cookie jar: `curl -c <file>`
on the login request, then `-b <file>` on every later one, 6 of them with
`-L`. Mirage's curl keeps the jar as curl does, in a file in the
workspace. The 10 finance tasks among them have mocks with a layout here,
and all 10 pass from their upstream directories, with the committed
tasks' nop scores. Four of them (finance-analysis-generate,
finance-dashboard-repair, finance-depreciation-audit and
finance-tax-prepare) also `COPY policies/ /workspace/policies/`, which
`liveclawbench.ts` carries out as any `COPY <src> <dest>` from
`environment/`. finance-budget-shift, the eleventh finance task, has no
scripted solution upstream (`openclaw: command not found`).

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
  lists what it lacks), which these tasks' checks do not need. A finance
  instruction's section on the email mock's REST API is gone, its heading
  left naming the mount and the CLI. finance-tax-prepare's solution
  answers the tax authority with `gws gmail reply`, whose subject is the
  instruction's "Re: Q1 2026 VAT Filing Reminder - Action Required";
  upstream's posts a new email with that subject.
- **Frozen clock.** Upstream's mocks seed relative to the wall clock and
  stamp writes with it. Here a run's clock is frozen at its epoch,
  2026-04-03T09:00:00Z, the date the tasks' solutions write, and moves a
  second per write. The weather mock's "today" is that date in China
  Standard Time, so its reseed when the date changes never happens. The
  finance mock stamps rows with SQLite's `datetime('now')` and its
  sessions' `iat` and `exp` with `Date.now()`; here both are the run's
  clock, and its seed's rows read the epoch (`fixtures/finance.ts`).
- **Ids.** The chat mock names each sticker file `crypto.randomUUID()`.
  Here a file's name is a UUID-shaped counter of the run's, and the seed's
  are counted too. No verifier reads them. The finance seed salts each
  password hash with `crypto.getRandomValues`, a counter's here, so the
  fixture is the same each time it is written; only login reads them.
- **The chat fake's store.** It has one table upstream's has not:
  `_sticker_file`, each sticker's bytes by its `storage_path`, which
  upstream keeps as files. A run is then one file. Prisma cannot state
  upstream's CHECK lists, so the routes enforce them as upstream's
  handlers do, and `PRAGMA table_info` shows each `id` NOT NULL. An
  upload's type is read as Bun reads it: from the file name's extension,
  ignoring the part's Content-Type. The pages are upstream's own
  components (`src/components/*.tsx`), bundled with esbuild and Hono's JSX
  runtime from upstream's checkout; the store's art is read from there too.
- **The finance fake's store and sessions.** It has one table upstream's
  has not: `_env`, the run's `TASK_NAME`, which upstream's mock reads from
  its environment (finance-budget-shift's fault depends on it) and a fake
  the job shares cannot; each task's fixture states it. Prisma cannot
  state upstream's CHECK lists; no route writes outside them, as zod and
  the handlers' constants keep each value in, as upstream's do.
  `asset_record` is read and edited in SQL: SQLite keeps a fractional
  `useful_life_years` in that INTEGER column as upstream writes it, which
  Prisma's typed calls truncate. Upstream signs sessions with a secret its
  process draws at start; here each run draws its own on its first login
  and forgets it when it resets, so a token from one run, or from before a
  reset, is refused by every other, as another process's is upstream.
  finance-budget-shift's one-shot fault (mock-lib's `shouldInject`) fires
  once per process upstream, once per run here. Login checks PBKDF2-SHA256
  at 600,000 iterations, as upstream's does, about a third of a second.
- **Instructions upstream's mock does not answer.** finance-tax-prepare's
  names `GET /api/invoices`, which upstream's mock lacks: a 404 there and
  here. finance-budget-shift's names no API, and its alert endpoint is only
  in upstream's code. Both stay as upstream wrote them.
- **Kit endpoints.** A shared fake has `/reset` and `/_kit/...`, which
  upstream's mocks lack. The trial's routing answers them 404.
- **Offline.** Every task here asks for the internet (`allow_internet`),
  and gets only its services; the environment logs a warning. The agents
  run on the host, so their model calls are unaffected. The capability
  declared is `disable_internet` alone, and no CPU or memory limits.
- **Time.** An `exec` is one Mirage line, and `workspace.yaml` gives a
  line 600 s (`@line` in `command_limits`). Past that it exits 124
  (`line: timed out after 600s`), however long Harbor's `timeout_sec`.
- **curl.** It lacks `-G/--get` (sending `-d` and `--data-urlencode` as
  the query) and the `-w` variable `%{redirect_url}`.
- **Python.** `python3` is Pyodide. It has no network, so the 15 verifiers
  that query a live service fail that step; weather-aqi-report's falls back
  to the seeded values, as upstream's code does. `zoneinfo` finds no time
  zones, since nothing loads Pyodide's `tzdata` for it (nutrition-log-meal).
  Of the 102, 4 verifiers use `subprocess` and 3 import the email app's
  Flask and SQLAlchemy models, which Pyodide cannot run.
  `MicrosandboxVerifier` runs the verifier in CPython instead, with the
  network to the trial's services and time zones (above).
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
  committed task's `/workspace/environment` holds upstream's `environment/`
  entries (`notes/`, `policies/`, `seed.sql`), not the Dockerfile.
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
