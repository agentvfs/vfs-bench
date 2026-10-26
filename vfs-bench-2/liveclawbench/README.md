# LiveClawBench

[Mosi-AI/LiveClawBench](https://github.com/Mosi-AI/LiveClawBench) @
`303dc77`, MIT. There are 134 assistant tasks over 16 mock web apps (email,
finance, shop, airline, ...). This port keeps the 113 that each task's own
verifier grades deterministically, and drops the LLM-judged ones.

## Setup

```sh
python3 -I liveclawbench/setup.py
```

This clones upstream into `state/liveclawbench/src`, checking out only
`mock-platform/` and `tasks/`. It then installs the mocks' dependencies from
`bun.lock`.

## How it maps

| Upstream | Here |
|---|---|
| Each task image runs its mocks, seeded for the task by `TASK_NAME` | Each mock runs unchanged under Bun (`mock/serve.ts`), with its database in the run, seeded the same way |
| The agent drives the apps at `http://localhost:<port>/` | Each mock's OpenAPI document becomes a CLI named for the mock (`email`, `finance`): one command per operation under `/api/`, with the session cookie kept |
| `instruction.md` | The same text, with each app URL replaced by its CLI (`task.json` `rewrite`). Each phrase must appear exactly once. |
| `tests/verify.py` on the apps' databases | The same verifier, unchanged, against the same databases. A task passes at score 1.0. |

## Divergences from upstream

- The agent uses the apps through their CLIs, not a browser.
- The mocks stamp `created_at` and `updated_at` from the wall clock, as
  upstream's do, so two seeds differ there by the time between them.
  `index.ts` declares those two fields (`clockFields`), and
  `harness/determinism.ts` reports them separately.
- The snapshot leaves out password hashes. Upstream salts them afresh on
  every seed, and no verifier reads them.

## Tasks

| Task | Upstream | Mocks |
|---|---|---|
| `finance-invoice-process` | `finance-invoice-process` | finance, email |
