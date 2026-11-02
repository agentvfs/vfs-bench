# ComplexMCP

[ATH-MaaS/complex-mcp](https://github.com/ATH-MaaS/complex-mcp) @ `7c01f92`,
MIT: all 47 rows of `benchmark/data/data.parquet`, each over 14 of
upstream's 15 MCP servers as kit fakes. Upstream's judge runs on Monty
(`graders/`).

## Fetch and run

From `vfs-bench-2/`:

```sh
uv run --project datasets/complexmcp python -I datasets/complexmcp/download.py
uv run --project datasets/complexmcp python -I datasets/complexmcp/convert.py --check
uv run --project formats/harbor harbor run -c datasets/complexmcp/harbor/job.yaml -a nop -n 32
uv run --project formats/harbor harbor run -c datasets/complexmcp/harbor/job.yaml -a oracle -n 32
```

The exporter and the comparison run in `complexmcp/`'s uv project, which
has upstream's fastmcp: the CLIs' schemas are what upstream's MCP servers
list. `harbor/job.yaml` uses `MirageVerifier`: Harbor freezes each app's
read-only login/logout replies and the pinned gold row, then launches a
separate Mirage VFS workspace. Monty 1.4.0 executes the original judge body
with a pure-Python Levenshtein implementation and writes rewards to RAM.
No SQLite, Pyodide, VM, network or host grading callbacks are used inside
grading. The existing fake-service storage is unchanged.

Validation: all 47 oracle trials passed, all 47 no-op trials scored zero,
and all 94 results exactly matched the original CPython judge with
Levenshtein 0.27.3 on the saved inputs. The runs used `-n 8` and completed in
1m50s and 1m17s respectively; these are local Harbor job timings, not a
controlled speedup comparison. Replay and mutation commands:

All 235 mutation comparisons matched the reference: no-op, exact gold,
empty final state, extra changes, and ID/float perturbations for every task. Unit tests additionally cover
Unicode, threshold boundaries, large integer preservation, concurrency,
read-only mounts and timeout cleanup.

| Upstream | Here |
|---|---|
| `docker/start_benchmark_sandbox.sh` starts the 15 servers on ports 8000 to 8007 and 9000 to 9006 | Each server is a kit fake, `mocks/complexmcp_<server>/`, the job's own, at upstream's port; a trial is a run of each |
| The client's `Toolbox` lists every server's tools for the model (`list_all`) | Each server is a CLI, `<server> <tool> --flag value` (`light-shop add-to-cart --sid ... --tid ... --cnt 1`), from `tools.json` (`tools.ts`); `instruction.md` lists every tool, as upstream's system prompt does |
| `AgentClient.__login` logs into LightSystem, then each of the row's apps, with its seed | Each Light app's fixture is the login (`kit/login.json`: the seed, the apps in order); its fake makes the session from it at reset |
| A call to a Light app gets the session's `session_id` added | A run is the session; a Light app's CLI also names the trial's run of LightSystem (below) |
| A tool's reply is fastmcp's text (`pydantic_core.to_json` of the result, a string as it is), or the client's `{'status': 'error', ...}` for an error | The same text, byte for byte |

## The fakes

`mocks/complexmcp/` is what the fakes share, each Light app's code
statement for statement from upstream's Python:

- `pyrandom.ts` is CPython's `random.Random`: its Mersenne Twister, seeded
  as CPython seeds an int, and `random`, `getrandbits`, `randrange`,
  `randint`, `choice`, `choices` (weighted too), `sample` (both of its
  algorithms), `uniform` and `gauss`, draw for draw. A run keeps its
  generator's state, `getstate()`'s words, so every later draw is upstream's
  too: LightTalk's network errors (`internel error`, until `acc_network`),
  LightShop's wrong payment password one time in ten, every id.
- `py.ts` is Python's values: a float is a `PyFloat`, an int a number, so a
  price prints `12.0` and a count `12`; `round` is CPython's correctly
  rounded one; `repr`, `str` and f-strings' `:.2f` are Python's; replies are
  `pydantic_core.to_json`'s, floats as Rust's ryu prints them. The plain
  servers add what they need: correctly rounded `libm` functions, Python's
  set order, `re` and `str.format`.
- `world.ts` logs in as upstream's client does. LightStock's login trades
  and LightNews's draws past times from LightSystem's clock, so an app's
  world depends on the ones logged in before it; each fake makes the whole
  login and keeps its own app's part.
- `fake.ts` serves an app: `POST /<tool>` (the arguments as JSON, the reply
  the text upstream's client hands the model), `/login` (what login
  answered) and `/logout` (what logout answers now). Its session is the
  run's SQLite (`complexmcp.prisma`), a row per field, only changed ones
  written back. `tool.ts` validates arguments as pydantic's lax mode does,
  with its error texts.
- `talk.ts`, `shop.ts`, `flight.ts`, `stock.ts`, `news.ts`, `weather.ts`,
  `system.ts`: the Light apps; `plain/*.ts`: the plain servers.

LightSystem's clock is every app's: an app's `os.step()` (a message's,
checkout's or trade's time) is a draw of the clock's own generator, in the
order the apps step it. As upstream's connector reaches it by its
`os_cfg`, each Light app's CLI sends `x-light-system: <the trial's run of
LightSystem>` (`headers` in its config, `clis/tools.ts`), and the app posts
LightSystem's `/_step`, `/_gen_past` and `/_now` there. A Light app the row
does not log into answers every tool as upstream's client does,
`{'status': 'failed', 'output': 'LightWeather has not been logged into
yet.'}`.

The OSINT server runs `whois`, `nmap`, `dnsrecon`, `dnstwist`, `dig` and
`host` on its host. Upstream's sandbox image (python:3.11-slim) installs
none of them, so each answers there its `FileNotFoundError`, `Error during
WHOIS lookup: [Errno 2] No such file or directory: 'whois'`, and so does
the fake, which runs nothing.

## Oracles and results

## Divergences

- **Lists.** A list of scalars the CLI gets no value for is `[]`
  (`post_moment`'s `--img-urls`, `cancel_booking`'s `--bids`): a repeatable
  flag cannot say `[]` otherwise. Upstream refuses a call that leaves one
  out. A union, `send_message_to_group`'s `at` (`list[str] | 'all'`), is a
  JSON flag, `--at '"all"'`.
- **Schemas.** A Light tool's flags are its MCP signature's, with
  `desc.json`'s descriptions, which upstream shows the model; they differ
  once: `desc.json` leaves out `comment_comment`'s `cid`, which the
  function requires.
- **Ports.** Upstream's servers speak MCP at `/mcp`; the fakes answer HTTP
  posts. A Light tool posted without `x-light-system` (curl at a port, not
  the CLI) has no clock and fails.
- **Sets.** Upstream lists a set's items in Python's per-process hash order
  (LightShop's starred shops and items, LightStock's watchlist); the fakes
  list them in the order they were added.
- **Validation errors.** pydantic's text prints the arguments with
  upstream's random session id; a stand-in of the run's takes its place.
- **Python.** The fakes follow the compare's CPython 3.14 and glibc's last
  place on the few `libm` results a correctly rounded one misses; upstream's
  image is 3.11, whose `sum` was not compensated and some of whose messages
  differ (`complexmcp_plain_probes.py` lists them).
- **Logout.** It answers the end environment and leaves the session, where
  upstream's ends it; only the verifier calls it.
