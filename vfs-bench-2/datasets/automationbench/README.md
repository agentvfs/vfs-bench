# AutomationBench

[zapier/AutomationBench](https://github.com/zapier/AutomationBench) v1.0.6
(`4a8e106`, MIT): all 600 public tasks, each a world of simulated SaaS
apps reached through `api search`, `api fetch` and `api base64-encode`. The
world is one kit fake (`mocks/automationbench/`), and upstream's rubric runs
on Monty (`graders/`).

## Fetch and run

From `vfs-bench-2/`:

```sh
uv run --project datasets/automationbench python -I datasets/automationbench/fetch.py
uv run --project datasets/automationbench python -I datasets/automationbench/generate.py --check
uv run --project formats/harbor harbor run -c datasets/automationbench/jobs/harbor.yaml -a nop -n 32
uv run --project formats/harbor harbor run -c datasets/automationbench/jobs/oracle.yaml -a oracle -n 32
```

| Upstream | Here |
|---|---|
| `WorldState`, in the environment's process | The `automationbench` kit fake (`mocks/automationbench/`): a run per trial, its world the `world` doc of the run's SQLite, `model_dump(mode="json")` of `meta` and the services the task is subscribed to |
| `setup_state`: the world from `initial_state`, gated by `compute_allowed_services` | `generate.py` builds it with upstream's code and writes it as the fixture (`workspace/fixtures/automationbench.json`), with the clock and id generators it goes on with |
| `api_search`, `api_fetch`, `base64_encode` (`toolset="api"`, the default) | The `api` CLI (`workspace/tools.ts`): `api search`, `api fetch`, `api base64-encode`, each flag a parameter, posted to the fake's `/<tool>`; the reply is the tool's text, an escaping exception's `f"{e}"` as verifiers formats it |
| `update_tool_args`: `{}` arguments dropped, the world passed | The same, in the fake (`fake.ts`) |
| The routers and handlers of `tools/api/`, the `tools/zapier` functions they call, the schemas' methods, defaults and validators | One port per service (`app_<service>.ts`), statement for statement; records built and validated by `models.ts` from every model's fields, types and default factories (`data/models.json`, written from the models), as Pydantic's lax mode does, with its 422s |
| `api_search`'s BM25 over the API schemas | The same scorer over the same index (`data/endpoints.json`, written from upstream's schemas) |
| The system prompt, then the user message; the tools' schemas | `harbor/instruction.md`: the system prompt, the tools as the CLI carries them, then the user message, verbatim |

**One fake for all 47 apps.** Upstream's world is one object: `api_fetch`
maps a URL to an app's router, gates it by the task's subscribed services
and shares one clock and one pair of id generators among the apps; tasks
span two to seven apps. So the fake is one service with upstream's URL
mapping and gate (`fetch.ts`) in front of a router per app, and a run's state
is one document, as upstream's is. Forty-three apps have a port; the four
no task subscribes to (facebook_conversions, facebook_lead_ads,
linkedin_ads, linkedin_conversions) answer upstream's 401, as every app
outside a task's world does.

**Ids and the clock.** At build time the exporter freezes upstream's clock
at the task's `meta.current_time` (or `2026-04-01T09:00:00Z` where a task
sets none: upstream's is the wall clock) and seeds `random` and the
generator `uuid.uuid4()` draws from with the task's name. Their states after
the build go into the fixture's `meta` doc, and the fake draws on from them
(`pyrandom.ts`, CPython's Mersenne Twister), so an id is the one upstream
would draw, in upstream's format. Each `api_fetch` call moves the clock on a
second, in both.

**Python's values.** The world is JSON, read and written as Python's `json`
does (`py.ts`: a whole float keeps its `.0`, `ensure_ascii`, Python's
`str`/`repr`/ordering), datetimes as Python's (`pydt.ts`), `json.loads`
errors with Python's positions (`pyjson.ts`), Python's argument binding and
its `TypeError`s (`world.ts`'s `bind`), `query.ts` for the SOQL, QuickBooks
and GAQL query engine, and a Python `Decimal` for the ledgers.

## Results

Native verifier validation (2026-10-30):

- **Harbor oracle + verifier:** all 11 real oracle scripts scored 1.0 in one
  job at `-n 11`, with no errors or retries (about 6 seconds).
- **Harbor no-op + verifier:** all 600 tasks scored 0.0 at `-n 32`, with no
  errors or retries (4m17s while other validation was running). This is an
  integration check, not an isolated throughput benchmark.

When the mock was made, it was compared with upstream's world:

- **Compare.** Every service against upstream's world on its tasks: about
  124,000 calls while porting (each service over every task subscribed to
  it, or 20 to 104 of them), and 16,480 calls over 164 task runs in the
  final run of all 44 call modules (`--per 4`): 0 differences in reply text,
  byte for byte, and in the world after each call. `KNOWN` holds one
  difference (below).
- **nop.** 0.0 on all 600 (`-n 4`, 22 min; 17 verifier VMs hung and
  were rerun). The exporter also refuses any task whose nop, computed on the
  world as built, reaches 1.0.
- `--check` passes, and writes the same fixtures in another process.

Of the 600 tasks, 11 have a verified oracle. Upstream ships no solutions;
the other 589 have their mock covered by that comparison and their nop
below 1.0.

## Skipped

None. No task's nop scores 1.0 (the exporter refuses one that does), and
every service a task subscribes to has a port.

## Divergences

- **Clock.** Upstream stamps records with the wall clock, moving through a
  run; here it is the task's epoch plus a second per `api_fetch` call, so
  records one call makes share a stamp. Tasks without `meta.current_time`
  run at `2026-04-01T09:00:00Z`. A naive `datetime.now()` is UTC's wall time.
- **Ids** are seeded with the task's name (above), where upstream's are
  random each run.
- **Python sets** whose order follows per-process string hashing cannot be
  matched; the fake keeps insertion order: Gmail's `threads.list` without
  `q` (its one `KNOWN`), Mailchimp subscriber tags and Google Ads customer
  list members once they hold two or more. No seeded world holds such a set.
- **State outside the models' fields.** Sheets marks the rows a write
  changed on `world.google_sheets._updated_row_keys`, which
  `google_sheets_row_updated` reads and `model_dump` drops; Google Ads keeps
  offline jobs on `_offline_jobs`. The fake keeps both in the `meta` doc's
  `hidden`, and `grade.py` sets the rows back on the world as upstream's
  handler sets them.
- **Dict keys that look like integers** (`"2024"`) come first in a
  JavaScript object, so a dict an agent writes with one dumps in another
  order. No seeded world has one.
- **ChatGPT** gives upstream's simulated reply: upstream reads
  `OPENAI_API_KEY` from the environment and calls OpenAI with one; the fake
  never has one.
- **Unicode corners**: Python's case mapping, `isdigit` and `\w` on
  non-ASCII text are JavaScript's here; Gmail does not uu-decode an
  `x-uuencode` part.
- **The tools** are a CLI: a model calls `api fetch --method ... --url ...`
  in a shell, where upstream's calls a function; `curl` and `wget` are off.
- **BambooHR's reads** look up action kinds no route records, so they are
  empty on every task, as upstream's; their aggregation code is ported but
  never reached.
