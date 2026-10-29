# VFS-Bench 2.0

Work in progress. VFS-Bench 2.0 runs recent, hard agent benchmarks through
[Mirage](https://github.com/strukto-ai/mirage)'s virtual terminal, and
nothing else. The agent never gets MCP tools. It gets one shell over a
workspace:

- **Files are mounts.** For example, Gaia2's drive is at `/cloud-drive` and
  Box is at `/box`.
- **Each benchmark's tools are CLIs that mirror them.** Tool
  `<server>__<tool>` becomes `<server> <tool> --param value`, generated from
  upstream's own tool schemas.
- **Services are local fakes.** Each is seeded per run and acts as the
  signed-in user. Where upstream ships its own simulation, it runs
  unchanged.
- **Graders are upstream's own** wherever possible. They check the
  services' end state, and an LLM judge only where upstream's grader asks
  one (Claw-Eval).

The plan and its status are tracked in the roadmap issue,
[agentvfs/vfs-bench#6](https://github.com/agentvfs/vfs-bench/issues/6).
Run dumps stay local; nothing is published yet.

## Datasets

| Dataset | Upstream | Ported | Services |
|---|---|---|---|
| [Agent-Diff](agentdiff/README.md) | agent-diff-bench/agent-diff | 11 of 224 | upstream's API replicas, in Docker |
| [AutomationBench](automationbench/README.md) | zapier/AutomationBench v1.0.6 | 11 of 606 | upstream's Python world |
| [Gaia2](gaia2/README.md) | Meta's ARE, gaia2-cli | 1 of 320 | upstream's apps, gaia2-cli |
| [DataSpace](dataspace/README.md) | HKUSTDial/DataSpace | 11 of 60 public | none, files only |
| [LiveClawBench](liveclawbench/README.md) | Mosi-AI/LiveClawBench | 11 of 113 | upstream's Node mocks, under Bun |
| [ComplexMCP](complexmcp/README.md) | ATH-MaaS/complex-mcp | 1 of 47 | 14 of upstream's 15 MCP servers |
| [Claw-Eval](claweval/README.md) | claw-eval/claw-eval | 11 of 126 | upstream's FastAPI mocks |

EnterpriseOps-Gym is skipped for now: its tool servers ship only as amd64
images of bytecode, with no source and no license.

## Setup

You need:
- Node 24.15 or later and pnpm
- uv, which fetches each dataset's Python
- Rust (`cargo`), which Mirage's TypeScript build uses
- Bun, for LiveClawBench
- Docker, for Agent-Diff

From `vfs-bench-2/`:

```sh
git submodule update --init submodule/mirage
(cd submodule/mirage/typescript && pnpm install && pnpm --filter @struktoai/mirage-core \
  --filter @struktoai/mirage-node --filter @struktoai/mirage-openai-agents build)
pnpm install
python3 -I setup/python.py      # the workspace's python3 packages, into state/python
```

Then run each dataset's setup, which its README gives. Setup downloads
upstream's code and data into `state/` at a pinned commit. `state/` is
gitignored, so nothing third-party is committed.

## Run

```sh
# A model, through the OpenAI Agents SDK (OPENAI_API_KEY, OPENAI_BASE_URL;
# a .env here is read if present).
node harness/run.ts gaia2/chats-cultures-oldest --model gpt-5.6-luna [--effort low] [--max-turns 50]

# A task's scripted solution (tests/oracle.sh) in place of a model. It must
# pass, and tests/noop.sh must fail.
node harness/oracle.ts gaia2/chats-cultures-oldest [script]

# Seed a task twice and compare the snapshots.
node harness/determinism.ts gaia2/chats-cultures-oldest

pnpm typecheck
pnpm test       # the harness's own checks, which need no dataset
```

### What a run does

`harness/execute.ts` runs these steps for every run, and none can be
skipped:
1. Start the task's fakes.
2. Seed them, then snapshot them.
3. Open the workspace from the task's `workspace.yaml`.
4. Let the agent work.
5. Snapshot again and grade.
6. Write `dumps/<run id>.json`. It holds the agent's items and usage, the
   checks, what changed between the two snapshots, and the Mirage commit.

The agent is Mirage's own OpenAI Agents integration: `read_file`, `shell`
and `apply_patch`, with `buildSystemPrompt` and the CLIs' docs. Its model
requests retry transient errors.

Every workspace is set up the same way:
- `python3` is Pyodide, with the packages `setup/python.py` bundles. Each
  command gets 2 GB and 300 s.
- The workspace is offline. Python has no network, and `curl` and `wget`
  are refused.
- The workspace can't reach the host's disk outside its mounts.
- The whole run is in UTC, including its fakes.
- A dataset with a task clock freezes it. Gaia2's apps, its `python3` and
  the shell's `date` all read the scenario's start.

## Layout

```
harness/      the run, oracle and determinism runners; fakes, workspace, dumps
clis/         CLI generators: from tool schemas (tools.ts), from OpenAPI
              (openapi.ts), and complete-task (answer.ts)
bridge/       serves a Python simulation as a fake (POST /reset, /call, GET /snapshot)
setup/        the workspace's python3 packages
submodule/    Mirage, pinned and unmodified
<dataset>/
  index.ts    load(slug): the task's instruction, fakes, seed, CLIs, snapshot and grade
  setup.py    downloads upstream at a pinned commit into state/<dataset>
  README.md   conversion rules and every divergence from upstream
  <task>/
    task.json        which upstream task this is
    workspace.yaml   the Mirage workspace: mounts, runtimes, limits
    tests/oracle.sh  a scripted solution, one shell call per block
    tests/oracle.reply.md  the solution's last reply, for a grader that judges it
    tests/noop.sh    doing nothing, which must fail
```

## License

MIT (see [../LICENSE](../LICENSE)). Upstream code and data keep their own
licenses. [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) records each source,
its license and the commit pinned.
