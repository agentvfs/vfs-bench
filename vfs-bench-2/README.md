# VFS-Bench 2.0

Work in progress. VFS-Bench 2.0 runs recent, hard agent benchmarks through
[Mirage](https://github.com/strukto-ai/mirage)'s virtual terminal, and
nothing else. The agent never gets MCP tools. It gets one shell over a
workspace:

- **Files are mounts.** For example, Gaia2's drive is at `/cloud-drive`.
- **Each benchmark's tools are CLIs that mirror them.** Tool
  `<server>__<tool>` becomes `<server> <tool> --param value`, generated from
  upstream's own tool schemas.
- **Services are local mock servers.** Each is seeded per run and acts as
  the signed-in user.
- **Graders are native Mirage graders.** They grade the services' end state
  in a Mirage workspace of their own, and ask an LLM judge only where
  upstream's grader does.

Harbor runs the tasks; it is only a wrapper. The plan and its status are
tracked in the roadmap issue,
[agentvfs/vfs-bench#6](https://github.com/agentvfs/vfs-bench/issues/6).

## Layout

```
vfs-bench-2/
  workspace/
  formats/
    harbor/
  datasets/
    <dataset>/
      fetch.py
      generate.py
      mocks/
      graders/
      jobs/
      tests/
      <task>/
        workspace/
        harbor/
```

- `workspace/`: the Mirage side every task shares: the daemon, the
  workspace a task's `workspace.yaml` builds, the mock launcher, the CLI
  generator and the grader runner.
- `formats/harbor/`: the Harbor wrapper, `vfsbench_harbor`:
  `MirageEnvironment`, `MirageVerifier`, and the Codex and Claude Code
  agents.
- `datasets/<dataset>/`: one benchmark, its mocks and graders, and its
  tasks. `datasets/layout.py` says what goes where in a task.

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

Then fetch each dataset you run:

```sh
uv run --project datasets/<dataset> python -I datasets/<dataset>/fetch.py
```

`fetch.py` downloads upstream's code and data at a pinned commit into
`state/<dataset>/` and writes the files a task needs that are not
committed: upstream's data, which cannot be redistributed here. `state/`
and those files are gitignored.

## Run

To start runs and watch them from a page instead, see [../ui](../ui/README.md).

```sh
# Every task's solution, then doing nothing.
uv run --project formats/harbor harbor run -c datasets/<dataset>/jobs/harbor.yaml -a oracle -n 32
uv run --project formats/harbor harbor run -c datasets/<dataset>/jobs/harbor.yaml -a nop -n 32
# One task.
uv run --project formats/harbor harbor run -p datasets/<dataset>/<task>/harbor \
  --env vfsbench_harbor:MirageEnvironment --verifier vfsbench_harbor:MirageVerifier -a oracle
# Codex or Claude Code on the host, their tools in the trial's workspace.
OPENAI_API_KEY=... uv run --project formats/harbor harbor run -c datasets/<dataset>/jobs/harbor.yaml \
  -a vfsbench_harbor:Codex -m openai/gpt-5.6-luna -n 28
```

Where only some tasks have a solution, `jobs/oracle.yaml` lists them.
[formats/harbor/README.md](formats/harbor/README.md) describes the
environment, the verifier and the agents.

```sh
pnpm typecheck
pnpm test
uv run --project formats/harbor python -I formats/harbor/test_environment.py
uv run --project datasets/<dataset> python -I datasets/<dataset>/generate.py --check
```

## License

MIT (see [../LICENSE](../LICENSE)). Upstream code and data keep their own
licenses. [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) records each source,
its license and the commit pinned.
