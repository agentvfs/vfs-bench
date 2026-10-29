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
  judge. Agreement with the judge is not measured yet. The search tasks
  ported are ones whose answer is a name, a number or a word, where exact
  match accepts what the judge would. Answers with a format the judge
  checks (`2700 sqft`, `$2150`, `Aug 30, 2024`) wait for it, as do
  questions whose full answer says more than the reference: search 0229
  asks "is there enough? If so, which movie?", and its reference is only
  the movie.
- **`date`.** The shell's `date` is a function over `date -d @<start>`.
  `type date` shows it, and it stays out of `history`.

## Tasks

| Task | Upstream | Apps |
|---|---|---|
| `chats-cultures-oldest` | search `0002_46myz87t501b0c902dy81rlbqbye2dyi` | Chats, Contacts |
| `night-emails-age-country` | search `0012_gbldmxqxhavpp8as08zds3g6zt1e17u8` | Emails, Contacts, Messages, Chats |
| `propaganda-research-attendee` | search `0034_50r3ienrscvru8yhhl2uwwu6my1dwz16` | Messages, Chats, Calendar |
| `october-top-nationality` | search `0038_3457v63wdhdhdlg2yt0jdawt94j10yf7` | Emails, Messages, Chats, Contacts |
| `august-venue-companion` | search `0231_8psanhd6g8y7jrqnd0n0s977eucupkxn` | Calendar, Contacts, Emails |
| `call-days-ride-duration` | search `0284_pmi8cc0i8x8l9ol5w8v9vnzj8jqpg6ha` | Calendar, Cabs |
| `kindergarten-dog-breed` | search `0295_xu1isz6ulvp0v1pn0nlprinmey9a36jn` | Contacts, Emails, Files |
| `oslo-lego-budget` | search `0396_4h1ozlei9bclo7xlsltfykc9dmvidj1j` | Contacts, Messages, Chats, Shopping |
| `messages-most-words` | search `0419_wxsb14bpy2d4vk180tjbg0xpwgsqabsq` | Messages, Contacts |
| `cabs-busier-month-flat` | search `0430_h041kg14zk7jm989zrvt0hbhdmaefz4q` | Cabs, RentAFlat |
| `bronwen-safest-zip-price` | search `0435_gvvzud9w5uz7hndhrry9ounortepplrc` | Contacts, RentAFlat, City |

Execution scenarios need scheduled events replayed and an end-state grader,
so they are not ported yet.
