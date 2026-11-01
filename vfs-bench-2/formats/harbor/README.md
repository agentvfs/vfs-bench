# Harbor

`vfsbench_harbor`, the [Harbor](https://pypi.org/project/harbor/) (0.25.0)
wrapper over a task's `workspace/`:

- `MirageEnvironment` (`environment.py`) runs each trial in a Mirage
  workspace on a daemon of the trial's own, in place of a container.
- `MirageVerifier` (`mirage_verifier.py`) grades it with the dataset's
  native grader, in a Mirage workspace of the grader's own.
- `Codex` and `ClaudeCode` (`agents.py`) run those CLIs on the host, their
  tools in the trial's workspace.

A task's `harbor/` is a Harbor task. Its `environment/mirage.yaml` names its
`workspace/` (`workspace: ../../workspace`), and `tests/test.sh` is a stub
that `MirageVerifier` never runs.

## Run

From `vfs-bench-2/`:

```sh
uv sync --project formats/harbor
uv run --project formats/harbor harbor run -c datasets/<dataset>/jobs/harbor.yaml -a oracle -n 32
uv run --project formats/harbor harbor run -p datasets/<dataset>/<task>/harbor \
  --env vfsbench_harbor:MirageEnvironment --verifier vfsbench_harbor:MirageVerifier -a oracle -k 2 -n 2
# Trials side by side cannot reach each other.
uv run --project formats/harbor python -I formats/harbor/isolation.py [--out <dir>]
uv run --project formats/harbor python -I formats/harbor/test_environment.py
uv run --project formats/harbor python -I formats/harbor/test_mirage_verifier.py
# A stand-in judge for a grader that asks one (it scores everything the same).
uv run --project formats/harbor python -I formats/harbor/mock_judge.py --port 8765 --score 1.0
```

`--ek node=<path>` names the Node binary if `node` on `PATH` is not 24.15 or
later. Each trial's environment is under `<trial dir>/mirage/`: the
generated `workspace.yaml` and `plan.json`, and the logs of the daemon. The
shared fakes log into the job's directory, as `fake-<service>.log`.

## The environment

`start()` seeds the trial's run on each fake the task's `workspace.yaml`
names (`fakes.py`), then runs `workspace/mirage.ts` to lay out the
workspace, then starts the trial's daemon and creates the workspace on it.

| Harbor on Docker | Here |
|---|---|
| Build `environment/Dockerfile` | Read `workspace/workspace.yaml` |
| The image runs the services on fixed ports | The job's shared kit fakes, the trial a run of each. `localhost:<upstream port>` and `127.0.0.1:<upstream port>` reach them |
| The services' data at `/var/lib/mock-data/...`, `/opt/mock/data/...` | The same paths, mounted read-only, holding a copy of each state file taken before every `exec` |
| `ENV`, `COPY`, `RUN`, `WORKDIR` | `env`, `copy` (from `workspace/files/`), `run` and `workdir` in `workspace.yaml` |
| `exec` | `POST /v1/workspaces/:id/shell?background=true`, then `POST /v1/jobs/:id/wait` |
| `/workspace`, `/logs`, `/tests`, `/solution`, `/tmp` | Disk mounts on directories under the trial's run dir |
| `upload_*`, `download_*` | Copies into and out of those directories |
| `python3` | Pyodide, from `workspace/python.py`'s bundle |
| The container's users | None. `user` changes nothing |

Mirage revalidates each mount's listings against its folder (`read: fresh`),
since the host writes them too. Every `exec` runs in a session of its own,
as `docker exec` does, so `cd` and `export` do not carry over.

## The verifier

`MirageVerifier` reads the task's grader definition: its dataset's
`graders/verifier.py` gives it where there is one, else
`graders/manifest.json`. It freezes the run's state through each fake's
private state view, and the files the definition names, then runs the
dataset's grader in a fresh RAM Mirage workspace: `workspace/verify.ts` for
a TypeScript grader (`graders/index.ts`), or the dataset's own
`graders/verify.ts` for a Monty one. The grader reads state through the
workspace's VFS alone: no host files, database or interpreter process, and
the agent's mounts are never its; a judge call (GAIA2's, Claw-Eval's) is
its only network. `workspace/verifier/` is
its `/tests/`; the definition pins each file it reads there.

Each grader writes the reward and its dimensions; `verifier/checks.json`
and `timings.json` sit beside them in the trial.

## Codex and Claude Code

`vfsbench_harbor:Codex` and `vfsbench_harbor:ClaudeCode` are Harbor's own
codex and claude-code agents, with the CLI run on the host, one process per
trial, in place of installed in a container. Every tool call of theirs runs
in the trial's workspace, and nothing they do reaches the host:

| | Codex | Claude Code |
|---|---|---|
| The CLI | `codex` on the host's `PATH` (0.147 and 0.165 tried) | `claude` on the host's `PATH` |
| Its tools | its own: shell, `apply_patch`, file reads | Mirage's MCP tools alone: shell, read, write, edit, ls, grep, glob |
| How they reach the workspace | a Codex environment (`$CODEX_HOME/environments.toml`, `include_local = false`) that runs `ssh ... <workspace>@127.0.0.1 -s codex-exec` against the trial's daemon; `codex exec -C /` | `--mcp-config` naming the workspace's MCP endpoint on the trial's daemon (`/v1/workspaces/<id>/mcp`), `--strict-mcp-config`, and `--tools ''`, which turns every built-in tool off |
| Off | web search, and the features that reach past the workspace (`CODEX_OFF`): the ChatGPT account's apps and plugins, browser and computer use, image generation | every built-in tool |
| Its trajectory | Harbor's ATIF, from codex's session rollouts | Harbor's ATIF, from Claude Code's session log |

Each trial's daemon listens for SSH on a loopback port of its own
(`MIRAGE_SSH_PORT`), and admits one key, which the Harbor process mints
when the first trial needs it (`environment.py`'s `ssh_key`); the SSH user
names the workspace. A session runs in the daemon, so its network is the
trial's, as `exec`'s is.

Harbor's agents set themselves up through the container: they write
their config and credentials under `/installed-agent` and `/tmp`, run the
CLI, and copy its session logs to `/logs/agent`. Here their `run()` is
Harbor's, handed a stand-in for the container (`agents.py`'s `_Host`):
each command runs in bash on the host, with those paths mapped to
directories of the agent's. `HOME` is one of them, so the host user's
`~/.codex` and `~/.claude` (their config, skills, memory and MCP servers)
reach no trial, and the CLI runs from an empty one. They sit under a
temporary directory while the CLI runs, since a CLI tells its model where
it runs (Claude Code its working directory and memory) and the trial's
path holds the job's date; afterwards `/logs/agent` moves into the trial's
agent directory and the rest into its `agent-host/`. Codex's bundled
skills are off (`[skills.bundled] enabled = false`): they run on the host,
and their catalog names a host path. The model's key is Harbor's, resolved
from the host as its agents resolve it.

Neither CLI's tools go through `MirageEnvironment.exec`, which brings the
workspace's copies of the services' state files up to date before each
command. So while a CLI runs, the copies are brought up to date when it
starts and then every second (`STATE_REFRESH`): a command sees the
services' state as it was at most a second before.

Tried against a scripted model (an OpenAI Responses and Anthropic
Messages server on localhost that asks for one shell command, then
answers): one trial each, then each agent on 38 LiveClawBench tasks at
`-n 28`. Every trial ran its command in its own workspace (its `/workspace`
lists its own task's files), wrote its trajectory and ended with no
exception: 38 trials in 56 s for Codex and 32 s for Claude Code.

With a real model, Codex on a ChatGPT login (`CODEX_FORCE_AUTH_JSON=1`,
which Harbor's agent reads `~/.codex/auth.json` for) solved
weather-aqi-report at 1.0: `gpt-5.6-luna` on codex 0.147, and `gpt-6-astra`,
which 0.147 is too old for, on codex 0.165. Mirage's codex-exec needed no
change for 0.165. Its commands and `apply_patch` ran in the workspace. Before
`CODEX_OFF`, the ChatGPT login also gave the model its apps' tools
(`mcp__codex_apps__...`), which run in OpenAI's cloud. Claude Code has not
run a real model yet.

38 LiveClawBench tasks with `gpt-6-astra` at `-n 28`: 212 s, no exception,
1.0 on 25 and a mean of 0.74, before the trial's date and zone (below), and
213 s and a mean of 0.74 after, each trial's model requests all dated by its
gateway. One sample each, so single tasks move both ways. None of the zeros
is the environment's: the model declined to answer
email-phishing-injection's sender, stopped at email-sending-verify's,
meeting-slot-race's and social-unlike-verify's faults, and found no API for
finance-budget-shift's alert (its instruction names none). Before, it
judged social-cross-publish's June dates past, and booked
interview-slot-verify's slot in the host's zone (0.3); after, it asks which
of the email's dates is the summit's, and books in UTC (1.0).

### The trial's date and zone

A run's services are frozen at the task's epoch (2026-04-03 for
LiveClawBench's tasks), as their fixtures were seeded; in upstream's container
the mocks seed relative to the wall clock, and the agent reads that same
clock. Here the agent runs on the host, so both its CLI and the workspace
would read the host's date and zone. Three things make them the trial's:
- **The workspace.** The daemon's clock is the run's epoch when the trial
  started, moving on since (`clock.ts`, loaded by the preload): `date`, file
  times and Python's `time` and `datetime`. Mirage starts Pyodide's worker
  with execArgv of its own, which drops the preload, so the preload wraps
  `worker_threads.Worker` to give every worker `clock.ts` too. Mirage has no
  clock setting for a workspace; this stands in for one.
- **The model.** Codex tells the model `<current_date>` and `<timezone>`,
  Claude Code "Today's date is", from the host. Neither takes a date, and
  both run under the hardened runtime, which a faked clock (libfaketime)
  cannot reach. So each trial has a gateway (`gateway.py`), its CLI's HTTPS
  proxy (`HTTPS_PROXY`): a `CONNECT` to a model's endpoint (chatgpt.com,
  api.openai.com, api.anthropic.com, or a base URL's, at its own port) is
  answered with TLS from a certificate the Harbor process's CA mints, which
  the CLI is told to trust (`CODEX_CA_CERTIFICATE`, `NODE_EXTRA_CA_CERTS`,
  with certifi's roots), or served as HTTP for an `http://` base URL. In
  each request, the date the CLI states (`<current_date>`, "Today's date
  is") becomes the run's where it is the host's, and Codex's `<timezone>`
  the trial's, UTC; nothing else changes, so a date in the task's data or a
  tool's result reaches the model as it is. The reply streams back as it
  is. Every other host is a plain tunnel; the loopback, where the
  workspace's endpoints are, is not proxied (`NO_PROXY`). A base URL in
  place of a proxy does not do:
  Codex on a ChatGPT login takes only ChatGPT's own HTTPS origin
  ("workspace routing discovery failed"). The gateway refuses websockets
  (404), so Codex falls back to HTTP, whose bodies it can read, and asks for
  no compression of its own (Codex's `enable_request_compression` is off).
  `<trial>/agent-host/gateway.log` lists each request, `(date)` where one
  was rewritten and `(host's date left)` where the host's date is still in
  it, as a CLI that states the date in a new way would leave it. With
  `gpt-6-astra`, interview-slot-verify's 14 model requests were all dated,
  none with the host's date left.
- **The zone.** The CLI runs with `TZ=UTC`, the trial's.

The agent's own session log, and so its trajectory, keeps the host's date:
it is written before the gateway. A trajectory shows what the CLI sent, not
what the model read.

Divergences:
- Claude Code's own Bash, Read, Edit, Write, Glob and Grep are off: on the
  host they would act outside the workspace. Its tools are Mirage's, with
  Mirage's names (`mcp__mirage__shell`).
- Codex's commands start in `/`, the trial's default workdir, since Codex
  checks `-C` on the local disk.
- `--ek daemon_url` (a shared daemon) has no SSH, so Codex cannot run on it.


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
run has used that seed. A task's `faults` are then armed on the run (`POST
/_run/<run>/_kit/faults`). Its stop calls `DELETE /_kit/runs/<run>`.

The trial reaches its runs as follows:
- `localhost:<upstream port>` goes to `<fake>/_run/<run>/<path>`, so
  upstream's `curl http://localhost:5003/api/stickers` is unchanged.
- A mount or CLI gets the run's base URL in the workspace config
  (`${GWS_URL}` in `workspace.yaml`), as the kit is designed for. Requests
  under it go as they are.
- Everything else is refused: another run's path on the real port, the
  real port outside the trial's runs, and the internet. Under a run, the
  kit's own endpoints (`/reset`, `/_kit/...`) answer 404, as upstream's
  services do.

Each trial keeps a Mirage daemon of its own: curl's routing is
process-global. A run's SQLite is the state file the verifier reads. The
kit keeps it in the rollback journal, not WAL, and the environment copies
it into the trial's read-only mount before each `exec`.


## Isolation

Each trial has its own daemon. A job's trials share its mocks, each with
runs of its own.

| Layer | Per-trial daemon (the default) |
|---|---|
| Workspace | Its own workspace on its own daemon |
| Files | Its mounts are its own run dir; no other host path is visible |
| Services | Its own runs on the shared fakes, each its own SQLite file, clock and ids |
| Network | Its own routes: its upstream ports and its mounts reach its own runs; every other path and port, another trial's or its own, and the internet are refused |
| CPU | Its own Node process and event loop, Pyodide included; nothing is capped |
| Crash | A daemon that dies ends only its trial. A shared fake that dies fails the trials using it |
| Verifier | A Mirage workspace of its own, which holds only the run's frozen state and the grader's inputs |

`isolation.py` starts nine trials at once from LiveClawBench's tasks:
chat-sticker-engagement twice (A and B, on one chat fake), weather-aqi-report
once (C), candidate-interview-slot-confirm twice (D and E, on one gws fake),
email-sending-verify twice (F and G, on that gws fake, each with its fault
plan armed), and finance-anomaly-detect twice (H and I, on one finance
fake). It checks from inside the workspaces that a trial sees only its own
state: on its data mount, through its API, its `/gmail` and `/calendar`
mounts and the `gws` CLI, mail and calendar events alike. It checks that a
trial cannot reach another's run by path through its own URL
(`localhost:5003/_run/b/...` is a 404 in its own run), by the shared fake's
real port, or outside its runs, and cannot reset its run. H and I each log
in with a cookie jar; each refuses the other's session cookie (`Invalid or
expired token`) and takes its own. It also checks one trial's commands
against each other: six at once each see its state, and a command canceled
mid-run (`asyncio.wait_for`) is stopped before it writes. And each run's
fault fires once, for that run alone: F's and G's first sends are answered
as sent and store nothing, their second sends are stored, and neither sees
the other's. All 63 checks pass: the 16 it had before the fakes were
shared among them, 8 for the calendar, 10 for the fault plans and 13 for
the finance fake.

`--ek daemon_url=<url>` creates the workspace on a running daemon instead.
That daemon cannot route each workspace to its own mocks: Mirage's curl
fetches through the process's global `fetch`, and nothing in Mirage is
scoped to a workspace. Sharing one daemon needs a per-workspace network
policy in the workspace config, an allowlist with host and port mapping
(`localhost:1235` to `127.0.0.1:53211`) that curl's HTTP layer applies for
the workspace it runs in.
