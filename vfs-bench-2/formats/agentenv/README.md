# agent-env

A task's `workspace/` as an [agent-env](https://github.com/scaleapi/agentenv-framework)
(`agentenv-framework` 0.9.1634) environment, beside [Harbor](../harbor/README.md).

- `server.py`, an `AgentEnvEnvironment` named `mirage`. `data/add` takes
  the task and opens its workspace on a Mirage daemon, with its fakes;
  its one tool is `shell`; `data/get` freezes what the grader reads;
  `data/reset` closes the workspace.
- `topology.py`, env provider type `mirage`: the server as a process on
  this machine, loaded with the task's environment artifact. No image is
  built or run.
- `grade.py`, the `env_outcome_verifier` script: the dataset's grader on
  `data/get`, its reward the row's score.

A dataset's bundle is `datasets/<dataset>/agentenv/`, written by
`bundle.py`:

```
envs/mirage/              env.toml, and the Dockerfile an env folder takes
artifacts/<task>/         task.json, the task's environment artifact
artifacts/grade/          verify.py
tasks/<task>.json         deploy_env, deploy_agent, prompt_agent,
                          env_outcome_verifier, reset_env
evals/agent.toml
```

Only ComplexMCP has one so far.

## Run

From `vfs-bench-2/`:

```sh
uv sync --project formats/agentenv
# agent-env's default agent (Claude Code), or --agent <name>. Its agents run
# in Docker and need its [model] endpoint. Ten tasks a run.
uv run --project formats/agentenv agent-env run datasets/complexmcp/agentenv \
  --task apple-watch-delete-history --task banana-peppers-per-neighbor
# Each task's solution/solve.sh as one shell call, then the grade.
uv run --project formats/agentenv python -I formats/agentenv/oracle.py complexmcp [-n 4]
uv run --project formats/agentenv python -I formats/agentenv/bundle.py complexmcp [--check]
uv run --project formats/agentenv python -I formats/agentenv/test_agentenv.py
```

`VFSBENCH_NODE` names the Node binary if `node` on `PATH` is not 24.15 or
later. A task's files are under `state/agentenv/<task>-<id>/`.

A workspace is about 3.5 GB (its daemon and one process per fake), and
agent-env runs four tasks at a time. A server outside agent-env's sandboxes
is not torn down by it: `reset_env` closes the workspace once it's graded,
and the server exits with the run.
