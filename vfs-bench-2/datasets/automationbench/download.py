"""Write AutomationBench's data into its tasks.

    uv run --project datasets/automationbench \
        python -I datasets/automationbench/download.py

Upstream (zapier/AutomationBench v1.0.6, MIT) builds its tasks in Python
through each domain's dataset loader; uv installs the pinned package from
this directory's pyproject. This runs ``convert.py``, which builds each
task's world with it and writes what is not committed: each world's
fixture (``workspace/fixtures/automationbench.json``) and what the rubric
reads besides the world (``workspace/verifier/task.json``).
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    return subprocess.run([sys.executable, "-I",
                           str(HERE / "convert.py")]).returncode


if __name__ == "__main__":
    raise SystemExit(main())
