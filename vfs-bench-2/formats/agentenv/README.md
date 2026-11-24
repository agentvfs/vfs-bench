# agent-env

`vfsbench_agentenv`, an [agent-env](https://github.com/scaleapi/agentenv-framework)
(`agentenv-framework` 0.9.1634) plugin over a task's `workspace/`. The
Mirage side is [Harbor](../harbor/README.md)'s, unchanged, so a task runs
the same under both:

- `MirageEnv` (`env.py`), env type `mirage`: `deploy()` starts the task
  through `vfsbench_harbor`'s `MirageEnvironment`, and the deployment is the
  workspace's MCP endpoint on its daemon. No container or sandbox.
- `mirage_oracle` (`steps.py`) runs the task's `solution/solve.sh` in the
  workspace, as Harbor's oracle agent does.
- `mirage_grade` (`steps.py`) grades with `MirageVerifier`, the dataset's
  native grader. Its reward is the step's grade.

A dataset's bundle is `datasets/<dataset>/agentenv/`, written by
`bundle.py` from its Harbor tasks:

```
envs/<task>/env.toml        type = "mirage", task = "<dataset>/<task>"
tasks/<task>.json           deploy_env, deploy_agent, prompt_agent, mirage_grade
tasks/<task>-oracle.json    deploy_env, mirage_oracle, mirage_grade
evals/agent.toml
evals/oracle.toml
```

Only ComplexMCP has one so far.

## Run

From `vfs-bench-2/`:

```sh
uv sync --project formats/agentenv
uv run --project formats/agentenv agent-env run datasets/complexmcp/agentenv --eval oracle
uv run --project formats/agentenv agent-env run datasets/complexmcp/agentenv \
  --task apple-watch-delete-history-oracle
# An agent, agent-env's default (Claude Code), or --agent <name>. agent-env's
# agents run in Docker and need its [model] endpoint.
uv run --project formats/agentenv agent-env run datasets/complexmcp/agentenv --eval agent
uv run --project formats/agentenv python -I formats/agentenv/bundle.py complexmcp [--check]
uv run --project formats/agentenv python -I formats/agentenv/test_agentenv.py
```

`VFSBENCH_NODE` names the Node binary if `node` on `PATH` is not 24.15 or
later. Each deployment's files are under `state/agentenv/<task>-<id>/`, as a
Harbor trial's: `mirage/`, `agent/` and `verifier/`.

A deployment lives in the process that made it, so a mirage env's steps
run in one `agent-env run`, not across processes.
