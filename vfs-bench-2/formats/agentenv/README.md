# agent-env

A task's `workspace/` as an [agent-env](https://github.com/scaleapi/agentenv-framework)
(`agentenv-framework` 0.9.1634) environment, beside [Harbor](../harbor/README.md),
on Mirage in place of Docker.

- `sandbox.py`, sandbox provider `mirage`: each sandbox is a task's Mirage
  workspace. An env's image is its Dockerfile, which names the task's
  `workspace.yaml`; `prepare_image` reads it and `create_sandbox` opens that
  workspace. No image is built or run.
- `server.py`, the env's `AgentEnvEnvironment`, named `mirage`. The agent's
  one tool is `shell`, on the task's workspace. `computer-exec/v1` `run` runs a
  line in the task's grade workspace (`workspace/grade.ts`, as Harbor's
  verifier opens it), and `data/get` reads its files back by path.

A dataset's bundle is `datasets/<dataset>/agentenv/`, written by
`bundle.py`:

```
envs/<task>/Dockerfile    LABEL workspace=<the task's workspace.yaml>
envs/<task>/env.toml      environment mirage, server topology
tasks/<task>.json         deploy_env (sandbox_type mirage), deploy_agent,
                          prompt_agent, run_container_unit_tests_verifier
evals/agent.toml
```

The verifier runs the task's test in the env, as agent-env runs a container's:
`grade` writes the grade to `logs/verifier/grade.json`, and its score is the
reward in `logs/verifier/reward.txt`.

Only ComplexMCP has one so far.

## Run

From `vfs-bench-2/`:

```sh
uv sync --project formats/agentenv
# agent-env's default agent (Claude Code), or --agent <name>. Its agents run
# in Docker and need its [model] endpoint. Ten tasks a run.
uv run --project formats/agentenv agent-env run datasets/complexmcp/agentenv \
  --task apple-watch-delete-history --task banana-peppers-per-neighbor
# Each task's solution/solve.sh as one shell call, then its test.
uv run --project formats/agentenv python -I formats/agentenv/oracle.py complexmcp [-n 4]
uv run --project formats/agentenv python -I formats/agentenv/bundle.py complexmcp [--check]
uv run --project formats/agentenv python -I formats/agentenv/test_agentenv.py
```

`VFSBENCH_NODE` names the Node binary if `node` on `PATH` is not 24.15 or
later. A task's files are under `state/agentenv/<task>-<id>/`. A workspace is
about 3.5 GB (its daemon and one process per fake), and agent-env runs four
tasks at a time.
