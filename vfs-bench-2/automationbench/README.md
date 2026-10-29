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

- Ids that upstream draws from `uuid4` or from `random` (HubSpot's,
  Zendesk's, Mailchimp's and others) come from generators seeded with the
  task's name. So two seeds give the same ids, in upstream's formats.
  Timestamps are not frozen: as upstream does, the world stamps what a task
  leaves undated from the wall clock, and most tasks set no
  `meta.current_time`, so it is the real time too. `index.ts` declares
  those fields (`clockFields`), and `harness/determinism.ts` lets only
  them differ between two seeds, by the time between the seeds.
- The apps are reached through the `api` CLI only. Nothing is mounted.
- The world never gets the model's OpenAI key. Given one, upstream's
  ChatGPT app calls OpenAI; without it, as here, the app gives upstream's
  own simulated reply.

## Tasks

| Task | Upstream |
|---|---|
| `invoice-email-extract` | `finance.invoice_email_extract` |
