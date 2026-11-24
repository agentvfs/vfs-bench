# JobBench

[JobBench/job-bench](https://huggingface.co/datasets/JobBench/job-bench) @
`d43a665` (data MIT) and
[Job-Bench/job-bench-eval](https://github.com/Job-Bench/job-bench-eval) @
`660b33a86e` (code Apache-2.0): 16 of its 128 tasks, the ones whose
deliverables are all text. No services: the task's files are at
`/workspace/task_folder` and the deliverables go to `/workspace/output`, which
an LLM judges item by item against the task's rubric (`graders/`).

## Fetch and run

`download.py` also builds upstream's agent image as a microsandbox
snapshot, so it needs `msb` 0.7.14 or later and the network. From
`vfs-bench-2/`:

```sh
uv run --project datasets/jobbench python -I datasets/jobbench/download.py
uv run --project formats/harbor harbor run -c datasets/jobbench/harbor/job.yaml -a nop -n 16
uv run --project datasets/jobbench python -I datasets/jobbench/tests/parity.py
```

| Upstream | Here |
|---|---|
| Its Harbor adapter's task (`harbor/jobbench_harbor/render.py`) | `<split>-<occupation>-<n>/harbor/`: the instruction verbatim, the timeouts and resources in `task.toml` |
| `environment.Dockerfile`: `task_folder/` copied to `/workspace/task_folder`, `/workspace/output` made | `workspace/workspace.yaml`'s `copy` and `run`; the files are `download.py`'s (`workspace/files/task_folder/`, not committed) |
| The image: Python 3.12 with `environment-requirements.txt`, `sqlite3`, poppler, tesseract, LibreOffice, pandoc, gdal | The snapshot `jobbench:<commit>`, which `download.py` builds from the Dockerfile's steps (plus `sshfs`, for Mirage's mount); each trial restores a sandbox of its own from it (`machines`), where `python3` and every program Mirage does not have run (`@python`, `@external`) |
| `runtime/verify.py` running `eval/judge.py` on `/workspace/output` | `graders/judge.ts`: the judge's text of each output file, its prompt and request per rubric item, its reply parsing, retries and score; and the verifier's refusals, where it publishes no reward |
| The judge's `JUDGE_API_BASE`, `JUDGE_API_KEY`, `JUDGE_MODEL` | The same names in `task.toml`, from the host's `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `JUDGE_MODEL`; upstream's `https://api.x.ai/v1` and `grok-4.3` the defaults |

`tests/parity.py` grades random output folders with upstream's `verify.py`
and `judge.py` under CPython and with the port, against one stub judge: a
case matches when both send byte-identical requests and give the same reward,
or both give none.

## Ported tasks

| Task | Reference files |
|---|---|
| main-technical-writers-1 | csv, json, md, txt |
| main-technical-writers-2 | csv, json, md, yaml |
| main-technical-writers-3 | csv, json, md, yaml |
| main-web-administrators-1 | conf, csv, html, json, rules, txt |
| easy-bookkeeping-accounting-and-auditing-clerks-1 | csv |
| easy-computer-user-support-specialists-1 | txt |
| easy-customer-service-representatives-1 | csv, pdf |
| easy-data-entry-keyers-1 | pdf |
| easy-data-entry-keyers-2 | pdf |
| easy-personal-financial-advisors-1 | csv |
| easy-personal-financial-advisors-2 | csv |
| easy-police-fire-and-ambulance-dispatchers-3 | csv |
| easy-reporters-and-correspondents-3 | csv |
| easy-social-science-research-assistants-1 | csv, pdf |
| easy-sociology-teachers-postsecondary-1 | csv |
| easy-statisticians-2 | csv |

Each of the other 112 asks for an Excel, Word, PDF, PowerPoint, notebook or
SQLite deliverable, which upstream's judge reads with Python libraries and
LibreOffice, or names no deliverable files.

## Where it differs

- **Offline.** Upstream's agent has the internet, and its instruction says it
  may search online; the workspace here has no network. None of the 16 needs
  it.
- **Text deliverables only.** The judge reads a `.xlsx`, `.docx`, `.pdf`,
  `.pptx`, notebook or database with upstream's libraries; the port raises on
  one, so the trial has no reward. The 16 tasks ask for none.
- **No oracle.** Upstream ships rubrics, not solutions.
