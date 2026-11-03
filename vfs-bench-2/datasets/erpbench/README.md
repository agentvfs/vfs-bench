# ERPBench-100

[blobfishai/erp-agent-simulation](https://github.com/blobfishai/erp-agent-simulation)
@ `5bdf458`, code Apache-2.0, data CC BY 4.0. A task is one tenant of a
synthetic ERP world in ten workflow families (order import, shipment
verification, collections, reorder, receiving and AP match, document
compliance, shift roll-up, channel order sync, hiring, price lists), over
six systems: `erpbench`, `oracle_fusion`, `gmail`, `google_drive`,
`google_sheets` and `slack`, 52 tools on one SQLite file. Upstream's grader
scores the world's end state, the submitted answers and the call trace:
reads before the first write, a readback after each write. No model judges
anything.

All 100 tasks are ported (`datasets/erpbench/<task>/`). The mail, files,
sheet and chat are Mirage mounts; the systems' tools are CLIs.

## Fetch and run

From `vfs-bench-2/`:

```sh
uv run --project datasets/erpbench python -I datasets/erpbench/download.py
uv run --project datasets/erpbench python -I datasets/erpbench/convert.py --check
uv run --project formats/harbor harbor run -c datasets/erpbench/harbor/job.yaml -a oracle -n 8
```

`download.py` clones upstream into `state/erpbench/src` and runs
`convert.py`, which writes what is not committed: each task's
`workspace/verifier/task.json` (upstream's task, with its expected answers
and rubric, which the grader reads), its `harbor/solution/` (`solve.sh` and
`trajectory.py`), and what the fake reads outside the workspace,
`state/erpbench/kit/<task>.json`: upstream's seeded world as SQL, the world
model, the task fields upstream's tools read and the witnesses of its files
and messages (Mounts, below). The fixture names only the task, so nothing
the agent can reach holds the expected answers or the rubric.
`convert.py --check` checks every task against upstream.

## How it maps

| Upstream | Here |
|---|---|
| `world` container: `service.py`, `ErpWorld` over a task-local SQLite, MCP over HTTP | The `erpbench` kit fake (`mocks/erpbench/`), one Node process per Harbor job and a run per trial: `world.ts` ports `ErpWorld._dispatch` and its views statement for statement; a run's file is upstream's seeded world, replayed from `iterdump` |
| `[[environment.mcp_servers]]`, one per system | One CLI per system (`workspace/tools.json`, `workspace/tools.ts`): `oracle-fusion sales-orders create --task-id ...`. Slack's is `slack-tools`, as Mirage registers a `slack` CLI of its own. They have every tool but the five reads the mounts serve |
| `gmail.messages.get`, `gmail.drafts.get`, `google_drive.files.download`, `google_sheets.spreadsheets.values.get`, `slack.conversations_history` | Mirage's own mounts, `/gmail`, `/drive`, `/sheets` and `/slack`, read-only, on the same fake, which answers their APIs (`routes.ts`) and records each read as the upstream tool (Mounts, below) |
| `tests/verify.py`, over `evidence.json` (baseline, snapshot, trace) | Ported to TypeScript, `graders/index.ts`, on `MirageVerifier`: the fake's private state view serves the seeded world, the world now, the trace (each call as `ErpWorld._record` makes it), the world model, as `json.dumps` text, and the mount reads' witnesses; `task.json` the rubric. No SQLite, Python or VM in grading |
| `solution/solve.py`, the reference's `oracle_steps` over HTTP | `harbor/solution/solve.sh`, the same steps, the five reads through the mounts and the rest as CLI calls, one timed step each, which `trajectory.py` writes as the agent's trajectory |

The six systems stay in one fake rather than Mirage's integ fakes: every
task uses `oracle_fusion` and `erpbench`, which have none, and the grader
reads one world's state and one trace across all six. The mounts reach this
fake too, not Mirage's gws and Slack fakes, so a CLI's write and a mount's
read meet in one world and one trace.

## Mounts

| Mount | Holds | A read recorded as |
|---|---|---|
| `/gmail` | `<label>/<day>/<subject>__<id>.gmail.json`: `INBOX`, and the task's draft under `DRAFT` | `gmail.messages.get {id}`, a draft's `gmail.drafts.get {id}` |
| `/drive` | `<file name>`, every file of the tenant's drive | `google_drive.files.download {fileId}`; the listing `google_drive.files.list {}`; `grep -w` (a Drive search) `google_drive.files.list {q}` |
| `/sheets` | `owned/<date>_<title>__<id>.gsheet.json`, the operations register, each range on its tab | `google_sheets.spreadsheets.values.get {spreadsheetId, range}`, once per range |
| `/slack` | `channels/<channel>__<id>/<day>/chat.jsonl` | `slack.conversations_history {channel}`, for a day with messages |

**A mount read counts only if the agent saw it.** A mount fetches more
than the agent asks for: listing a Gmail label fetches every message,
`grep -r` over `/drive` downloads every file. So the fake keeps, beside
each read it records, the host time it arrived and a witness, the text the
read served that shows it was read, and the grader keeps the read only if
the trajectory step that issued it shows the witness in a tool result
(`graders/seen.ts`), as ClawEval counts an email as read. The step is the
latest at or before the read, so a read keeps its place before or after the
writes. The witnesses:

| Read | Witness |
|---|---|
| a Drive file, an email | its first line after the first, within forty, whose first 50 characters (at least 10 flattened) are in no other file, email, sheet, chat message or the prompt (not a header line the current and superseded versions of a file share); an email without one (the request mail is the task's prompt) its start as the `.gmail.json` prints it, `"body_text":"...`, and a file without one the first 50 characters of each of its first three lines that has at least 10 |
| a draft | its start as the `.gmail.json` prints it |
| a sheet's range | the text cells of its first two rows, or their numbers where it has no text |
| a chat day | the start of any of its `chat.jsonl` lines |
| the drive's listing | the first three names |
| a Drive search | any file it found; one that found nothing counts |

Text is compared with escapes read, whitespace dropped and case folded,
so `cat`, `jq`, `grep` and a JSON-printing script all show it. Mirage's
cache and the mounts' listing index are off (`workspace.yaml`), so every
read reaches the fake. The oracle's own trajectory is on the workspace's
clock, which `MirageVerifier` relates to the host's (`epoch`, `host`).

What this cannot carry:
- **Reads are what the agent saw, not what it called.** Upstream counts a
  call whatever came back of it. A file read and summarized by a script
  that prints neither its witness nor its text does not count; a `grep`
  that prints only other lines of a file does not either.
- **Credit is per step.** A read counts when its step's output shows its
  witness, whichever of the step's commands printed it. Output that shows
  only in a later step (a command left running and polled later) does not
  count for the read.
- **Mount reads without a usable trajectory fail the grade.** With mount
  reads recorded, a missing trajectory, one that is not JSON, or one with no
  timestamped agent step is the harness's failure, not the agent's, so the
  grade errors rather than dropping them. Without mount reads (nop) the
  trajectory is not read. An agent step without a timestamp counts with the
  timestamped step before it, and a timestamp without a zone is UTC.
- **A day's listing reads it.** Mirage lists a Slack day with the request
  that reads it, so listing a day records a read, which counts only where
  the step shows a message.
- **What the mounts show.** An email's `task_id` field is not in its
  `.gmail.json`; a sheet is its ranges merged onto tabs, each written range
  over the ones before it, and one anchored past 10,000 rows or 1,000
  columns below its tab's rows; a chat message's `user` is the author's
  name. The Drive mount shows file names, not upstream's `version` or
  `isCurrentAuthority`, which `google-drive files list` and `get` still
  give.

## How the fake and grader are checked

`tests/compare.py` runs every task under each of upstream's seven
policies (`oracle`, `noop`, `shortcut`, `state_only`, `wrong_source`,
`wrong_target`, `overprocess`) and a set of malformed calls per workflow
family, against upstream's `ErpWorld` and a fresh run of the fake, the
arguments as the CLI sends them: 710 runs, 14,944 calls, no difference in
replies, error texts, the 31 tables (after each seed and at the end) or the
trace. Upstream's grader over the fake's end state gives upstream's reward
for all 700 task × policy runs, and the native grader, on the state the
fake's verifier view serves, gives the same reward and passes the same
rubric checks. `tests/grader.test.ts` covers the end states those policies
never reach (answers within or past 0.005, figures in other formats,
labels for ids, register rows misplaced, out-of-scope writes, a second
record, values upstream raises on): upstream's `score_episode` and the
native grader must agree on each.

`tests/mounts.test.ts` runs Mirage's own mounts, from a task's
`workspace.yaml`, on the fake: what each `cat`, `ls` and `grep` records,
with which arguments, and that its witness is in what the read printed and
not in what a listing or `head -n 1` printed. `tests/seen.test.ts` covers
`graders/seen.ts`, and `tests/test_convert.py` the witnesses of all 100
worlds and the oracle's steps.

## Oracle

All 100 tasks: the oracle scores 1.0 and doing nothing 0.03, as on
upstream's Docker environment. The 0.03 is upstream's
`containment:task_scope` (3 points), which passes while nothing changes.

## Divergences

- **Whole floats inside untyped JSON arrays.** The CLI reads a JSON flag
  with `JSON.parse` and sends it with `JSON.stringify`, so `41180.0` in an
  order's `lines` arrives as `41180`; the fake restores floats only where
  the schema types a value `number`. It changes what a few stored payloads
  look like, and none of the 700 compared rewards.
- **Replies.** The CLI prints a reply as JSON reparsed in JavaScript, so a
  whole float shows as `41180` where upstream's MCP text has `41180.0`.
- **Mount reads** count when seen (Mounts, above).
