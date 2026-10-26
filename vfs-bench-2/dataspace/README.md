# DataSpace

[HKUSTDial/DataSpace](https://github.com/HKUSTDial/DataSpace) @ `6491caa`,
MIT, with the dataset @ `96be192` (MIT). There are 410 analytical questions
over a task-local workspace of CSV, JSON, SQLite, Markdown, PDF and video.
The answer is a CSV table. Only 60 tasks have public answers.

## Setup

```sh
python3 -I dataspace/setup.py
```

Upstream ships its tasks as one 2.9 GB zip, and setup doesn't download all
of it. It reads only the ported tasks' entries, by HTTP range requests, and
checks each file against the archive's own `checksums.sha256`. The tasks'
inputs, gold CSVs and configs land in `state/dataspace/benchmark`, and
setup also fetches upstream's `evaluation/evaluate.py`.

## How it maps

| Upstream | Here |
|---|---|
| The task's `context/`, read-only at `/workspace` | The same, mounted read-only |
| The answer at `/output/prediction.csv` | The same; `/output` is the run's own directory |
| `relation_task_prompt` (contract relation-v2) as the user prompt | The same, verbatim |
| `TOOLS.md`, describing the Docker workbench | `/opt/dataspace/TOOLS.md`, rewritten for this workspace |
| `evaluate.py` against `gold.csv` | The same evaluator, unchanged |

## Divergences from upstream

- **Tools.** The workbench is this workspace, which `workbench/TOOLS.md`
  describes:
  - `python3` with pandas, NumPy, PyArrow, PyMuPDF, pypdf, Pillow, OpenCV
    and the `sqlite3` module;
  - `read_file` for PDFs and images.
- **Not available:** OCR, video and speech recognition. Tasks that need
  them are expected to fail until frames or text are precomputed at setup.

## Tasks

| Task | Upstream |
|---|---|
| `china-credit-trends` | `task_35` |
