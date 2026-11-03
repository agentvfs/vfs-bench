# VFS-Bench 2.0

Work in progress. VFS-Bench 2.0 runs recent, hard agent benchmarks through
[Mirage](https://github.com/strukto-ai/mirage)'s virtual terminal, and
nothing else. The agent never gets MCP tools. It gets one shell over a
workspace:

- **Files are mounts.** For example, Gaia2's drive is at `/cloud-drive`.
- **Each benchmark's tools are CLIs that mirror them.** Tool
  `<server>__<tool>` becomes `<server> <tool> --param value`, generated from
  upstream's own tool schemas.
- **The workspace describes itself.** Mirage's `/VFS.md` lists its mounts
  and `/SKILL.md` each CLI's help.
- **Services are local mock servers.** Each is seeded per run and acts as
  the signed-in user.
- **Graders are native Mirage graders.** They grade the services' end state
  in a Mirage workspace of their own, and ask an LLM judge only where
  upstream's grader does.

[Harbor](https://pypi.org/project/harbor/) runs the tasks; it is only a
wrapper. The plan and its status are tracked in the roadmap issue,
[agentvfs/vfs-bench#6](https://github.com/agentvfs/vfs-bench/issues/6).

## Datasets

| Dataset | Upstream | Tasks | Graders |
|---|---|---:|---|
| [LiveClawBench](datasets/liveclawbench/README.md) | Mosi-AI/LiveClawBench | 70 | TypeScript |
| [AutomationBench](datasets/automationbench/README.md) | zapier/AutomationBench v1.0.6 | 600 | Monty |
| [Claw-Eval](datasets/claweval/README.md) | claw-eval/claw-eval | 126 | TypeScript, built from upstream's |
| [ComplexMCP](datasets/complexmcp/README.md) | ATH-MaaS/complex-mcp | 47 | Monty |
| [DataSpace](datasets/dataspace/README.md) | HKUSTDial/DataSpace | 46 | Monty |
| [EnterpriseOps-Gym](datasets/enterpriseops/README.md) | ServiceNow/EnterpriseOps-Gym | 103 | TypeScript |
| [Gaia2](datasets/gaia2/README.md) | Meta's ARE, gaia2-cli | 460 | Monty |

## Setup

You need Node 24.15 or later and pnpm, uv, Rust (`cargo`, for Mirage's
TypeScript build) and Bun (for LiveClawBench's seeds). From `vfs-bench-2/`:

```sh
git submodule update --init submodule/mirage
(cd submodule/mirage/typescript && pnpm install && pnpm --filter @struktoai/mirage-core \
  --filter @struktoai/mirage-node --filter @struktoai/mirage-openai-agents build)
# The Prisma clients of Mirage's integ fakes (gws, slack, ...), which the
# Harbor tasks on them import from integ/generated.
(cd submodule/mirage/integ && ls prisma/*.prisma | INTEG_DB_URL=file:/tmp/mirage-generate.db \
  xargs -P 4 -n 1 node_modules/.bin/prisma generate --schema)
pnpm install
uv sync --project formats/harbor
python3 -I workspace/python.py      # the workspace's python3 packages, into state/python
```

Then download each dataset you run:

```sh
uv run --project datasets/<dataset> python -I datasets/<dataset>/download.py
```

`download.py` downloads upstream's code and data at a pinned commit into
`state/<dataset>/` and writes the files a task needs that are not
committed: upstream's data, which cannot be redistributed here. `state/`
and those files are gitignored.

## Run

From `vfs-bench-2/`. To start runs and watch them from a page instead, see
[../ui](../ui/README.md).

```sh
# One task, its solution (solve.sh), one trial.
uv run --project formats/harbor harbor run -y -p datasets/gaia2/ambiguity-0132/harbor \
  --env vfsbench_harbor:MirageEnvironment --verifier vfsbench_harbor:MirageVerifier -a oracle

# Every task, 256 at once, on one Mirage daemon with 8 workers.
uv run --project formats/harbor harbor run -y -c datasets/gaia2/harbor/job.yaml \
  -a oracle -n 256 --ek workers=8

# Codex on the host, its tools in each trial's workspace. Gaia2's judge
# reads OPENAI_API_KEY.
OPENAI_API_KEY=... uv run --project formats/harbor harbor run -y -c datasets/gaia2/harbor/job.yaml \
  -a vfsbench_harbor:Codex -m openai/gpt-5.6-luna -n 64 --ek workers=8
```

- `-n`: how many trials run at once.
- `-l 16`: the first 16 tasks only. `-i <task>`: one task by name.
- `-a nop`: an agent that does nothing, which every task should fail.
- `--ek workers=<n>`: every trial on one daemon for the job, with `n`
  worker processes. Without it, each trial starts a daemon of its own.
- `-a vfsbench_harbor:ClaudeCode`: Claude Code instead, with Mirage's MCP
  tools alone.

Where only some tasks have a solution, `harbor/oracle.yaml` lists them.

## One trial

```
harbor run
└── trial
    ├── environment.start()                      MirageEnvironment
    │   ├── open this trial's runs on the job's mock servers
    │   ├── mirage.ts lays out the workspace (files, plan.json)
    │   ├── the job's Mirage daemon (the first trial starts it)
    │   └── create the workspace
    │         system_time   the task's epoch
    │         network       this trial's runs alone
    │         clis          the task's tools
    │         /VFS.md, /SKILL.md
    ├── agent.run()
    │   ├── oracle: solve.sh, through the workspace's shell
    │   └── Codex: codex exec, through the workspace's codex-exec
    ├── verifier.verify()                         MirageVerifier
    │   ├── freeze the services' state and the trajectory
    │   ├── create a grade workspace, the frozen inputs read-only
    │   ├── run grade: the dataset's grader, in the daemon
    │   └── write the reward
    └── environment.stop()
          close the workspace, drop this trial's runs
```

Each trial's workspace keeps its own clock, network, files and tool log,
even when the whole job shares one daemon.
[formats/harbor/README.md](formats/harbor/README.md) describes the
environment, the verifier and the agents in full.

A job is written to `jobs/<job>/`, one directory per trial:

```
jobs/<job>/
  <trial>/
    result.json      reward, error, the time of each phase
    agent/           trajectory.json (ATIF) and the agent's logs
    verifier/        reward.txt, checks.json, timings.json
    mirage/          plan.json, workspace.yaml, the tool calls
  fake-<service>.log the mock servers'
  mirage-*.log       the daemon's and mirage.ts's
```

## Layout

```
vfs-bench-2/
  workspace/
  formats/
    harbor/
  datasets/
    <dataset>/
      download.py
      convert.py
      mocks/
      graders/
      harbor/
      tests/
      <task>/
        workspace/
        harbor/
        grader.ts
```

- `workspace/`: the Mirage side every task shares: the daemon's preload,
  the workspace a task's `workspace.yaml` builds, the mock launcher, the CLI
  generator and the `grade` CLI.
- `formats/harbor/`: the Harbor wrapper, `vfsbench_harbor`:
  `MirageEnvironment`, `MirageVerifier`, and the Codex and Claude Code
  agents.
- `datasets/<dataset>/`: one benchmark, its mocks and graders, and its
  tasks. A task's own grader is its `grader.ts`, where it has one;
  `graders/` holds what the dataset's graders share and the entry that
  runs them. Neither is ever mounted in the agent's workspace.
  `download.py` downloads upstream at a pinned commit into `state/`,
  `convert.py` writes the tasks from it (`--check` compares them), and
  `harbor/` holds the dataset's Harbor job configs (`job.yaml` for every
  task, `oracle.yaml` where only some have a solution).
  `datasets/layout.py` says what goes where in a task.

## Tests

```sh
pnpm typecheck
pnpm test
uv run --project formats/harbor python -I formats/harbor/test_environment.py
uv run --project formats/harbor python -I formats/harbor/test_mirage_verifier.py
uv run --project datasets/<dataset> python -I datasets/<dataset>/convert.py --check
```

## License

MIT (see [../LICENSE](../LICENSE)). Upstream code and data keep their own
licenses. [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) records each source,
its license and the commit pinned.
