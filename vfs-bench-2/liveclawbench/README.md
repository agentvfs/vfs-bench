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
| Each task image runs its mocks, seeded for the task by `TASK_NAME` | Each mock runs unchanged under Bun (`mock/serve.ts`), with its data files in the run, seeded the same way |
| The Dockerfile's `ENV`, such as `MOCK_FINANCE_SEED_SQL` | The same variables (`task.json` `env`), pointing into upstream's task directory |
| The agent drives the apps at `http://localhost:<port>/` | Each mock's OpenAPI document becomes a CLI named for the mock (`email`, `finance`): one command per operation under `/api/`, with the session cookie kept |
| `instruction.md` | The same text, with each app URL replaced by its CLI (`task.json` `rewrite`). Each phrase must appear exactly once. |
| `tests/verify.py` on the apps' data files | The same verifier against the same files, at this run's paths (`grade.py`). A task passes at score 1.0. |

## Divergences from upstream

- The agent uses the apps through their CLIs, not a browser.
- Most verifiers name the fixed paths the task image keeps the mocks' files
  at (`/var/lib/mock-data/email/email.db`, `/tmp/mosi_shop_orders.json`),
  and write their reward files to `/logs/verifier`. `grade.py` runs a copy
  of the verifier with each of those paths replaced by this run's, and
  changes nothing else. `index.ts` lists each mock's paths (`DATA`).
- The mocks stamp `created_at` and `updated_at` from the wall clock, as
  upstream's do, and so do the chat's `sent_at` and the shop's
  `create_time`. Two seeds differ there by the time between them.
  `index.ts` declares those fields (`clockFields`), and
  `harness/determinism.ts` reports them separately.
- The snapshot leaves out password hashes and the chat's sticker file paths.
  Upstream draws both afresh on every seed (a salt, a random UUID), and no
  verifier reads them.

## Tasks

| Task | Upstream | Mocks |
|---|---|---|
| `finance-invoice-process` | `finance-invoice-process` | finance, email |
| `finance-expense-log` | `finance-expense-log` | finance |
| `finance-monthly-close` | `finance-monthly-close` | finance |
| `finance-portfolio-rebalancing` | `finance-portfolio-rebalancing` | finance |
| `finance-anomaly-detect` | `finance-anomaly-detect` | finance |
| `finance-budget-alert` | `finance-budget-alert` | finance, email |
| `procurement-quote-compare-reply` | `procurement-quote-compare-reply` | email |
| `chat-sticker-engagement` | `chat-sticker-engagement` | chat |
| `mint-diet-comprehensive` | `mint-diet-comprehensive` | mint-diet |
| `washer-change` | `washer-change` | shop |
| `watch-shop-silent-fail` | `watch-shop-silent-fail` | shop |
