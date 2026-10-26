# AutomationBench

[zapier/AutomationBench](https://github.com/zapier/AutomationBench) v1.0.6
(`4a8e106`), MIT. There are 606 business-workflow tasks across 47 simulated
SaaS apps. Each is graded on the end state of its world.

## Setup

```sh
uv run --project automationbench python -I automationbench/setup.py
```

uv installs the pinned package from `pyproject.toml`. Setup writes each
ported task's row, as upstream's dataset loader builds it (noise included),
to `state/automationbench/tasks/<task_name>.json`.

## How it maps

| Upstream | Here |
|---|---|
| `AutomationBenchEnv` with `toolset="api"`, the default | Upstream's `WorldState`, tools and rubric, unchanged behind the bridge (`world.py`) |
| Tools `api_search`, `api_fetch`, `base64_encode` | The CLI `api search`, `api fetch` and `api base64-encode`, described as upstream describes them to a model |
| `setup_state`: the world from `initial_state`, gated by `compute_allowed_services` | `reset`, the same way |
| `update_tool_args`: drop `{}` arguments, pass the world | `call`, the same way |
| The system prompt, then the user message | The system prompt, then the CLIs' docs; the user message is the instruction |
| `partial_credit`; a task counts at 1.0 (`task_completed_correctly`) | The same. Each assertion is a check, and the run passes at 1.0. |

## Divergences from upstream

- Ids that upstream draws from `uuid4` come from a generator seeded with
  the task's name. So two seeds give the same world, and the ids still
  look like UUIDs.
- The apps are reached through the `api` CLI only. Nothing is mounted.

## Tasks

| Task | Upstream |
|---|---|
| `invoice-email-extract` | `finance.invoice_email_extract` |
