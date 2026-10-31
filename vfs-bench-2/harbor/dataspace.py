"""Write the committed DataSpace tasks from upstream, or check them.

    python3 -I dataspace/setup.py      # upstream's data, into state/
    uv run --project harbor python -I harbor/dataspace.py [--check] [task ...]

Each task under ``harbor/tasks/dataspace/<slug>/`` is a Harbor task made
from upstream's ``input/task_N/task.json`` (HKUSTDial/DataSpace, code and
data MIT, pinned by ``dataspace/setup.py``). Upstream's data is not
committed: the task's context, its gold CSV and frozen config, and the
evaluator stay in ``state/dataspace/`` and reach a trial from there.

- ``instruction.md``: upstream's user prompt (``relation_task_prompt``,
  contract relation-v2) over the task's question, verbatim.
- ``task.toml``: the upstream task id, upstream's wall time for the agent.
- ``environment/mirage.yaml``: the context mounted read-only at
  ``/workspace`` from ``${STATE}`` in place of the trial's own, the answer
  written to ``/output``, and ``/opt/dataspace/TOOLS.md``.
- ``environment/workbench/TOOLS.md``: ``dataspace/workbench/TOOLS.md``.
- ``tests/test.sh``: the stub (``harbor/test.sh``). ``MirageVerifier`` runs
  upstream's evaluator on ``/output/prediction.csv``, ported to Monty.
- ``solution/solve.sh``: ours, by hand, for the tasks that have one.

``--check`` writes nothing and exits 1 if a file differs from what upstream
gives, if a file is unaccounted for, or if the task's data is missing from
``state/``.
"""
import argparse
import json
import sys
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
STATE = ROOT / "state" / "dataspace"
BENCHMARK = STATE / "benchmark"
PORT = ROOT / "dataspace"
OUT = HARBOR / "tasks" / "dataspace"
TEST_SH = HARBOR / "test.sh"
COMMIT = "6491caa"
REVISION = "96be192"
# Upstream's `wall_time_seconds` (baseline/configs/harness.yaml).
WALL_TIME = 1800.0

# The 46 public tasks committed here, by slug. The first eleven are the
# pre-Harbor port's (dataspace/<slug>/), with its oracles.
TASKS = {
    "fund-ytd-returns": "task_33",
    "china-credit-trends": "task_35",
    "weekly-benchmark-top10": "task_43",
    "latest-treatments": "task_44",
    "regional-gdp-sectors": "task_58",
    "culture-before-admission": "task_87",
    "nonlisted-shares-by-province": "task_129",
    "deposit-corp-reserve-assets": "task_168",
    "pre-2000-money-banking": "task_264",
    "manager-alpha-top10": "task_267",
    "icu-stay-calendar-days": "task_409",
    "monetary-authority-total-assets": "task_10",
    "fund-ten-year-returns": "task_18",
    "latest-rmb-new-loans": "task_86",
    "placements-over-10bn": "task_123",
    "underwriting-over-50m-shares": "task_128",
    "diphtheria-screening-term": "task_133",
    "shanxi-listed-companies": "task_140",
    "qdii-managers-over-20bn": "task_166",
    "archived-funds-monthly-top10": "task_182",
    "funds-positive-daily-benchmark": "task_184",
    "lowest-initial-subscription": "task_196",
    "short-tenure-managers": "task_199",
    "full-float-companies": "task_200",
    "retail-catering-records": "task_208",
    "one-year-benchmark-top10": "task_215",
    "fund-awards-by-appraiser": "task_257",
    "fund-returns-since-start": "task_259",
    "three-year-benchmark-positive": "task_263",
    "shareholder-allocation-000423": "task_269",
    "most-bond-kinds-fund": "task_279",
    "kesi-trading-days-over-100m": "task_285",
    "jiangsu-full-float-count": "task_298",
    "lof-weekly-benchmark": "task_322",
    "electronics-manufacturers-count": "task_326",
    "enteral-formula-daily-max": "task_329",
    "deposit-corp-asset-extremes": "task_336",
    "repeat-seasoned-issuers": "task_337",
    "jiangsu-full-float-count-zh": "task_361",
    "three-year-benchmark-positive-zh": "task_362",
    "fund-returns-since-start-en": "task_371",
    "non-chinese-managers": "task_380",
    "top-daily-return-fund-type": "task_382",
    "latest-deposit-corp-over-50m": "task_391",
    "trust-company-holdings-2021": "task_402",
    "patient-max-respiration": "task_127",
}

# The other 14 public tasks, and why each is not committed.
VIDEO = ("its question reads its answer's criteria off context/video/"
         "briefing.mp4, and the workspace has no video decoding, frames or "
         "speech recognition")
SKIPPED = {
    "task_23": VIDEO,
    "task_24": VIDEO,
    "task_48": VIDEO,
    "task_85": VIDEO,
    "task_102": VIDEO,
    "task_103": VIDEO,
    "task_111": VIDEO,
    "task_159": VIDEO,
    "task_300": VIDEO,
    "task_312": VIDEO,
    "task_328": VIDEO,
    "task_378": VIDEO,
    "task_389": VIDEO,
    "task_398": VIDEO,
}


def prompt(task_id: str, question: str, workspace_path: str,
           output_path: str) -> str:
    """Upstream's ``relation_task_prompt`` (baseline/src/
    dataspace_baselines/core/prompt.py), verbatim."""
    return f"""Task ID: {task_id}

Question:
{question}

All task input artifacts are located under:
{workspace_path}

Solve the task using only those artifacts. Internet access is unavailable.
The preinstalled generic data-processing utilities are documented at
/opt/dataspace/TOOLS.md. Package installation is unavailable.
Write the complete requested relation to:
{output_path}

The answer must be a rectangular UTF-8 CSV with one header row. A header-only
CSV is valid when the requested result is empty. Return all requested rows and
columns; do not replace the CSV with a prose answer.

Do not finish the task until the exact file path above exists. Before ending,
verify that its filename is exactly prediction.csv, that it is readable as a
rectangular CSV, and that it contains the complete final relation. A prose
response or a differently named file does not count as submission. Once the
verified prediction.csv is ready, terminate the session."""


def task_toml(task_id: str) -> str:
    return f"""version = "1.0"

[metadata]
task_id = "{task_id}"
upstream = "HKUSTDial/DataSpace@{COMMIT}, dataset @{REVISION}, {task_id}"
category = "data-analytics"

[verifier]
timeout_sec = 300.0

[agent]
timeout_sec = {WALL_TIME}

[environment]
build_timeout_sec = 300.0
cpus = 2
memory_mb = 2048
storage_mb = 4096
allow_internet = false
"""


def mirage_yaml(slug: str, task_id: str) -> str:
    benchmark = "${STATE}/dataspace/benchmark"
    return f"""# {task_id} ({slug}), on vfsbench_harbor's mirage environment
# (harbor/dataspace.py writes it).
#
# No services. The task's context is upstream's, from state/ (run
# dataspace/setup.py), mounted read-only at /workspace in place of the
# trial's own; the answer goes to /output/prediction.csv, as upstream's
# harness lays them out.
fakes: {{}}
copy:
  /opt/dataspace: workbench/
workspace:
  replace: [/workspace]
  mounts:
    /workspace:
      vfs: disk
      mode: read
      config: {{root: '{benchmark}/input/{task_id}/context'}}
    /output:
      vfs: disk
      mode: write
      read: fresh
      config: {{root: '${{RUN_DIR}}/output'}}
    /opt/dataspace:
      vfs: disk
      mode: read
      config: {{root: '${{RUN_DIR}}/opt/dataspace'}}
"""


def expected(slug: str) -> dict[str, bytes]:
    """Every file this writes for a task, by path in its directory."""
    task_id = TASKS[slug]
    question = json.loads(
        (BENCHMARK / "input" / task_id / "task.json").read_text())["question"]
    out = {
        "instruction.md":
        (prompt(task_id, question, "/workspace", "/output/prediction.csv") +
         "\n").encode(),
        "task.toml":
        task_toml(task_id).encode(),
        "environment/mirage.yaml":
        mirage_yaml(slug, task_id).encode(),
        "environment/workbench/TOOLS.md":
        (PORT / "workbench" / "TOOLS.md").read_bytes(),
        "tests/test.sh":
        TEST_SH.read_bytes(),
    }
    ours = OUT / slug / "solution" / "solve.sh"
    if ours.is_file():
        out["solution/solve.sh"] = ours.read_bytes()
    return out


def data_problems(task_id: str) -> list[str]:
    """What the task needs from state/ and setup has not put there."""
    needed = [
        BENCHMARK / "input" / task_id / "task.json",
        BENCHMARK / "input" / task_id / "context",
        BENCHMARK / "output" / task_id / "gold.csv",
        BENCHMARK / "evaluation" / "configs" / f"{task_id}.json",
        STATE / "evaluation" / "evaluate.py",
    ]
    return [
        f"{p.relative_to(ROOT)} is missing (python3 -I dataspace/setup.py)"
        for p in needed if not p.exists()
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("tasks", nargs="*", default=list(TASKS))
    args = parser.parse_args()
    # Upstream's 60 public tasks, each committed or skipped, not both.
    assert len(set(TASKS.values())
               | set(SKIPPED)) == len(TASKS) + len(SKIPPED) == 60
    unknown = [t for t in args.tasks if t not in TASKS]
    if unknown:
        parser.error(f"not a committed task: {', '.join(unknown)}")
    failed = 0
    for slug in args.tasks:
        target = OUT / slug
        problems = data_problems(TASKS[slug])
        files = {} if problems else expected(slug)
        for rel, data in files.items():
            path = target / rel
            if args.check:
                if not path.is_file():
                    problems.append(f"{rel} is missing")
                elif path.read_bytes() != data:
                    problems.append(f"{rel} differs from upstream's")
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                if rel.endswith(".sh"):
                    path.chmod(0o755)
        for path in sorted(target.rglob("*")) if files else []:
            rel = path.relative_to(target).as_posix()
            if path.is_file() and rel not in files:
                problems.append(f"{rel} is not generated")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {slug} ({TASKS[slug]})")
        for problem in problems:
            print(f"    {problem}")
    if args.tasks == list(TASKS):
        stray = sorted(p.name for p in OUT.glob("*")
                       if p.is_dir() and p.name not in TASKS)
        for name in stray:
            print(f"FAIL {name}: not a committed task")
        failed += len(stray)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
