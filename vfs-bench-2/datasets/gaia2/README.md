# Gaia2

Gaia2 (Meta's [ARE](https://github.com/facebookresearch/meta-agents-research-environments)
@ `a9fd2ed`, MIT; data CC BY 4.0 with the Llama terms): 460 scenarios of
its search, execution and ambiguity splits, each app a kit fake
(`mocks/gaia2_<app>/`), its commands a CLI. Upstream's judge runs on Monty
(`graders/`). The data is never committed: `download.py` writes each task's
instruction, fixtures and drive from it.

## Fetch and run

From `vfs-bench-2/`:

```sh
uv run --project datasets/gaia2 python -I datasets/gaia2/download.py
uv run --project datasets/gaia2 python -I datasets/gaia2/convert.py --check
uv run --project formats/harbor harbor run -c datasets/gaia2/harbor/job.yaml -a nop -n 32
uv run --project formats/harbor harbor run -c datasets/gaia2/harbor/job.yaml -a oracle -n 32
```

`<split>-<NNNN>/`: 460 Gaia2 scenarios, all 160 of the search
split, 146 of the 160 of the execution split and 154 of the 160 of the
ambiguity split
([meta-agents-research-environments/gaia2](https://huggingface.co/datasets/meta-agents-research-environments/gaia2)
@ `78ea3bd`, CC BY 4.0 with the Llama terms in `../../THIRD_PARTY_LICENSES`), on
the apps of gaia2-cli, Meta's CLI port of ARE's apps (meta-agents-research-environments
@ `a9fd2ed`, MIT). An assistant works a phone's apps (contacts, emails,
messages, chats, calendar, a cloud drive, cabs, shopping, flats, a city
guide) for one request; upstream's judge compares its write calls and its
reply with the scenario's oracle events. An ambiguity scenario's request
cannot be done as asked: its oracle does what it can and asks the user,
and that question is the reply the judge compares, in the same one turn.

Before grading, the verifier preserves `gaia2-inputs.json` (service state,
events, trajectory and any replay oracle order) and `gaia2-scenario.json`
(the exact pinned scenario bytes) in its host-only log directory. Together
with `reward_details.json`'s recorded judge calls, these survive staging and
fake-run cleanup for replay. Harbor's log include/exclude filters apply;
these files contain no judge credentials and are never mounted for the agent.

`graders/reference/` holds upstream's judge sources at `a9fd2ed` (MIT).
`graders/build.py` produces `graders/port.py`: Pydantic models become dataclasses, enum members
become strings, properties become methods, static text dedenting happens at
build time, and a few unsupported standard-library operations get equivalents.
The checker and matching algorithms and prompt text remain upstream's.
LLM checker initialization and audit-log failures are fatal, preventing
upstream's optional-dependency fallback from masking a broken port.

When the port was made, validation covered 3,573 frozen-input cases across all 460 scenarios,
including oracle-shaped events, no reply, missing/extra writes, changed answers
and reworded app content with absent, accepting and rejecting judge responses.
Each case matched the unchanged CPython daemon parser, final-turn collector and
judge in both recorded-response replay and default-order local HTTP runs
(7,146 comparisons, zero differences).
These synthetic cases complement the full Harbor oracle run recorded in
`graders/validation.json`: **460/460 unique tasks passed**, in four disjoint
115-task batches with `-n 115`, no retries, no exceptions and no nonzero oracle
exits. All 460 saved trial states and trajectories also matched the pinned
CPython reference's binary reward. The run reached 115 workspace server
processes alive at once; oracle and verifier phases overlapped, including
19 oracles and 86 verifiers at one instant. Phase timings include staging and
waits; separate process samples observed up to 76 verifier processes.

Gaia2's data is never committed. `convert.py` writes the files made from it
into each task, and `.gitignore` (which it writes too) keeps them
out of git: `harbor/instruction.md`, `workspace/fixtures/` (the fixtures),
`workspace/files/drive/` and the replayed `harbor/solution/solve.sh`. The scenario
itself goes to `state/gaia2/harbor/<task>/`, which only the verifier
gets. A fresh checkout runs these tasks once setup and `convert.py` have run.

| Upstream (gaia2-cli in its container) | Here |
|---|---|
| One click program per app, its state a JSON file in `GAIA2_STATE_DIR` that `gaia2-init` writes from the scenario | A kit fake per app, `mocks/gaia2_<app>/`: the app's state as one doc of the run's SQLite, seeded from that same file (`gaia2-init` run at export) |
| A command, one process: load the state, work on it, save, `log_action` a line to `events.jsonl`, print `json.dumps(..., indent=2)` or an error on stderr | `POST /<cli>/<command>` on the trial's run, the handler upstream's command statement for statement; the line an `event` row; the reply the text upstream prints |
| The apps' binaries on `PATH` | One CLI per app (`workspace/tools.ts`), each command and option from upstream's click program (`workspace/tools.json`); an option is its first spelling (`--folder-name`, not `--folder`) |
| The Files app, `cloud-drive` | A disk mount, `/cloud-drive`: the scenario's tree as `gaia2-init` lays it out, a copy of its own each trial (`copy`, an APFS clone); emails and messaging read and write attachments there (`extras`) |
| libfaketime frozen at the scenario's start (the runner's `FAKETIME`) | Each run's clock is the scenario's start, frozen (`epoch`); the workspace's clock (its `system_time`) and the model's date start there (gateway.py) |
| `uuid.uuid4()` | A counter of the run's, hashed: the same ids every time |
| `AGENTS_TEMPLATE.md` rendered for the scenario, then the scenario's message | `harbor/instruction.md`: the same render with four edits (`EDITS`: `/workspace` for `/home/agent`, the drive a mount, not a CLI), the notifications section cut (nothing delivers them; these splits have no ENV events), then `## Task` and the message, verbatim |
| The agent's reply, logged as `send_message_to_user` by its adapter | The last message of the agent's Harbor trajectory |
| Reward 1.0 if the judgment succeeds, else 0.0 | The same; `reward_details.json` has the judgment, the daemon's `judgments.jsonl`, its status and each model call |

The judge needs the model for every check its equality does not settle
(gaia2-core's `_equality_checker`: case, accents and punctuation aside). Run
without `OPENAI_API_KEY` the engine answers nothing, so such a check is
inconclusive, a fail: a reply equal to the oracle's passes, any other fails.
That is how the oracle and nop runs below were graded; no judge model was
called, so no score here is a real judge's.

The judge's route was checked with `mock_judge.py --content` on two
oracles edited to need it (kept out of the repo): search 0004 with its
answer in a sentence, and execution 0052 with both emails reworded. With
no key both fail, their checks inconclusive; with a stand-in answering
`[[Success]] [[True]]` both pass (one model call and four, each with the
key and the model's name); answering `[[Failure]] [[False]]` both fail on
those checks.

## The fakes

`mocks/gaia2/store.ts` is what every app shares: the store (`doc` rows
`state` and `meta`, and `event`), the route per command, ids, the clock and
Python's behaviour where JavaScript's differs: `pyjson.ts` (a whole float
stays a float, `json.dumps` with `ensure_ascii`), `jsonLoads` (Python's
decode errors, word for word), `pyrepr.ts`, `pytime.ts` (`strptime` and
`strftime` as `_strptime` does them), `difflib.ts` (`SequenceMatcher`, for
`lookup-user-id`), `pyre.ts` (Python's `re` over JavaScript's, for
`regex-search`) and `pyos.ts`. Each app is `mocks/gaia2_<app>/app.ts`:
contacts, emails, messages and chats (one module, as upstream's two differ
by a line), calendar, cabs, rent-a-flat, shopping and city, every command,
the hidden ENV commands included. The meta doc names the class an app logs
under (`app_class_map.json`'s, `MessagingAppV2` for both messaging apps).
A messaging command and a chats command share their names, so each tool's
`call` in `tools.json` is `<cli>.<command>`, by which `tools.ts` finds its
endpoint.

Emails, messages and chats read and write attachments on the drive. A
fake's block in `workspace.yaml` may give `extras`, which go with the trial's
reset to the kit's `afterSeed` (`fakes.py`, `environment.py`), `${RUN_DIR}`
the trial's run dir: `{drive: '${RUN_DIR}/cloud-drive', view: /cloud-drive}`
puts the trial's drive in the run's meta doc, and a path on it prints as
the workspace sees it.

## Results

| Split | Tasks | Oracle | nop |
|---|---|---|---|
| search | 160 | 1.0 on all 160 | 0.0 on the 79 run |
| execution | 146 | 1.0 on all 146 | 0.0 on the 129 run |
| ambiguity | 154 | 1.0 on all 154 | 0.0 on the 136 run |

## Skipped

- **19 scenarios whose oracle calls the Files app** (`mv`, `mkdir`, `rm`):
  14 of execution and 5 of ambiguity (0177, 0200, 0213, 0553, 0562). The
  drive is a mount, whose operations log no event, so the judge would find
  the agent's moves missing (`convert.py`'s `SKIPPED`, with each reason).
- **ambiguity 0198**, the one scenario of these splits in which the user
  writes to the agent twice: its second message needs a turn after the
  first, which nothing here delivers.
- **The other splits.** Adaptability and time need ENV events fired as the
  agent works, a moving clock and a turn after the first (the daemon's
  notifications). agent2agent replaces apps with other agents. The fakes
  have the hidden ENV commands, and the event log is upstream's, but
  nothing here fires them.

## Divergences

- **The drive.** `cloud-drive`'s commands (`ls`, `cat`, `mv`, ...) are file
  commands on `/cloud-drive`, and log no events (above). A download's path
  prints as `/cloud-drive/...`, where upstream prints its state directory's.
- **Options.** Each option is its first spelling; click's aliases
  (`--folder`, `--download-path`, `--path1`) are not taken. A missing or
  badly typed option is refused by the workspace's CLI with its own message,
  where click prints its usage (exit 2).
- **Clock.** Frozen at the start for every app, as upstream's runner freezes
  it; a city rate limit, once hit, never cools down, as upstream's would not
  either.
- **Ids.** Deterministic, not `uuid4`'s random ones.
- **Python's `re`** for `regex-search` is translated to JavaScript's;
  conditional groups and `\N{...}` are refused (`pyre.ts`).
- **Uncaught exceptions.** Where upstream prints a traceback, the fake
  prints its last line (`ValueError: ...`).
- **The reply.** The trajectory's last agent message; an agent that writes no
  trajectory, or no message, hands in no reply, so the turn never ends and
  there is no judgment: 0, as upstream's runner scores it.
- **The state files** are visible read-only in the workspace at
  `/var/lib/mock-data/gaia2/`, as every committed task's services' are. They
  hold the apps' state and the calls' log, which the CLIs show anyway; the
  oracle is only in the separate verifier workspace.
