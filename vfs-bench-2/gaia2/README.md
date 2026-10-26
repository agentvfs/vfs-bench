# Gaia2

[Meta Agents Research Environments](https://github.com/facebookresearch/meta-agents-research-environments)
`gaia2-cli` @ `a9fd2ed` (MIT) with the Gaia2 data (CC BY 4.0, plus the
Llama terms recorded in [THIRD_PARTY_LICENSES](../THIRD_PARTY_LICENSES)).
There are 320 scenarios for an assistant on a phone's apps: contacts, email,
messages, chats, calendar, a cloud drive, cabs, shopping, flats and a city
guide.

## Setup

```sh
uv run --project gaia2 python -I gaia2/setup.py
```

This does three things:
- Exports the search and execution scenarios from the dataset @ `78ea3bd`
  to `state/gaia2/scenarios/<split>/<id>.json`.
- Downloads the drive's files from `gaia2_filesystem` @ `132e263`.
- Fetches gaia2-cli's `AGENTS_TEMPLATE.md`.

## How it maps

| Upstream | Here |
|---|---|
| gaia2-cli's app binaries, one per app (`chats`, `contacts`, ...) | The same binaries, unchanged, behind the bridge (`world.py`). Each app is a CLI of the same name and commands, generated from its click options. |
| State seeded by `gaia2-init` from the scenario | The same, into the run's state directory |
| The Files app | Its drive is a CLI (`cloud-drive`), and is also mounted at `/cloud-drive` |
| `AGENTS_TEMPLATE.md`, rendered for the scenario | The same render (`prompt.py`), with the edits below |
| libfaketime freezes the container at the scenario's start | The apps (`launch.py`), python3 (`clock.py`) and the shell's `date` all read the scenario's start |
| Search scenarios are judged by an LLM | The answer must equal the oracle's `send_message_to_user`, after normalizing case, spaces and a trailing full stop |

## Divergences from upstream

- **Prompt edits** (`EDITS` in `index.ts`, each applied to exactly one
  place):
  - the workspace is `/workspace`, not `/home/agent`, and the drive is at
    `/cloud-drive`;
  - the agent hands in its answer with `complete-task --answer` instead of
    replying;
  - the notifications section is cut, because this harness doesn't deliver
    scheduled events yet.
- **Grader.** Search answers use normalized exact match, not Gaia2's LLM
  judge. Agreement with the judge is not measured yet.
- **`date`.** The shell's `date` is a function over `date -d @<start>`.
  `type date` shows it, and it stays out of `history`.

## Tasks

| Task | Upstream |
|---|---|
| `chats-cultures-oldest` | search `0002_46myz87t501b0c902dy81rlbqbye2dyi` |

Execution scenarios need scheduled events replayed and an end-state grader,
so they are not ported yet.
