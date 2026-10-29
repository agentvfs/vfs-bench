# ComplexMCP

[ATH-MaaS/complex-mcp](https://github.com/ATH-MaaS/complex-mcp) @
`7c01f92`, MIT. There are 47 tasks over 15 Python MCP servers:
- chem, crypto, graphs, lang, math, osint, time and unit;
- the "Light" apps: Flight, News, Shop, Stock, System, Talk and Weather.

## Setup

```sh
uv run --project complexmcp python -I complexmcp/setup.py
```

This clones upstream into `state/complexmcp/src` and exports the tasks to
`state/complexmcp/tasks.json`.

## How it maps

| Upstream | Here |
|---|---|
| `docker/start_benchmark_sandbox.sh` starts the 15 servers | The same servers but OSINT, unchanged, on free local ports, started behind the bridge (`world.py`) |
| The `Toolbox` client calls `<Server>.<tool>` | One CLI per server, generated from the tools it lists: `light-talk get-contacts-by-tag --tag family` |
| The Light apps' tools, from their `desc.json` | The same descriptions, without `login`, `logout` and the hidden `session_id` |
| `AgentClient.__login` logs into LightSystem, then each task app, with the task's seed | `reset`, the same way. Each call to a Light app gets its `session_id` added. |
| `benchmark/judge.py` compares the end environment (what logout returns) with the expected one | The same judge. The run passes when every expected change was made and nothing else changed. |

## Divergences from upstream

- The OSINT server is left out. Its tools run `whois`, `nmap` and `dig`
  on the host, which would put the live network in an offline workspace.
  No task uses it.
- Upstream's `retrieve_tools` mode is left out. `--help` and the CLIs' docs
  do the discovery.
- The shell can do arithmetic (`awk`, `python3`), so the math and unit
  servers are optional here.
- The judge also skips `trid`, the LightShop and LightStock transaction
  id. Upstream skips the other ids its apps draw from the session's seeded
  random generator (`rid` and `oid` since its `3e45e5d`), but not this
  one. It comes out the same only when a run draws as often before each
  checkout or trade: every `add_to_cart`, `wait_payment_password` and
  earlier trade draws. So one extra add and remove before checkout, or the
  same trades in another order, failed a correct run. 27 tasks expect a
  new transaction.

## Tasks

| Task | Upstream |
|---|---|
| `family-group-airpods` | task 2 (seed 42; LightTalk, LightShop) |
| `remove-silent-classmates` | task 8 (seed 42; LightTalk) |
| `family-and-classmate-groups` | task 12 (seed 42; LightTalk) |
| `business-flight-sf-ny` | task 21 (seed 1; LightTalk, LightFlight) |
| `fashion-brand-days-chickpeas` | task 32 (seed 8; LightTalk, LightShop, LightNews) |
| `mangosteen-and-mango` | task 35 (seed 8; LightShop) |
| `homecoming-play-endive` | task 37 (seed 8; LightTalk, LightShop, LightNews) |
| `nike-to-20-shares` | task 43 (seed 41; LightStock) |
| `tech-stocks-flight-bitter-gourd` | task 44 (seed 108; LightTalk, LightShop, LightFlight, LightStock) |
| `liquidate-short-news-flight` | task 45 (seed 114514; LightTalk, LightFlight, LightStock, LightNews) |
| `butternut-new-year-messages` | task 46 (seed 123; LightTalk, LightShop) |
