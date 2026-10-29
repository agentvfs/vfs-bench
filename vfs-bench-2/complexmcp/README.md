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

## Tasks

| Task | Upstream |
|---|---|
| `family-group-airpods` | task 2 (seed 42; LightTalk, LightShop) |
