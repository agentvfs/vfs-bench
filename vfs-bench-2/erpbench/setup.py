"""Fetch Blobfish's ERPBench-100 at its pinned commit.

    python3 -I erpbench/setup.py

Clones blobfishai/erp-agent-simulation (code Apache-2.0, data CC BY 4.0)
into ``state/erpbench/src``. Its Harbor release,
``benchmark/erpbench100/release/harbor/tasks/erpbench-NNN/``, is what
``harbor/erpbench.py`` exports: upstream's world and grader are stdlib
Python, so this needs no project of its own.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "state" / "erpbench"
REPO = "https://github.com/blobfishai/erp-agent-simulation.git"
COMMIT = "5bdf458165fee71f6a7965ea30ca33dfbbce1332"


def main() -> int:
    src = STATE / "src"
    if not (src / ".git").is_dir():
        STATE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", REPO, str(src)], check=True)
    subprocess.run(
        ["git", "-C", str(src), "checkout", "--quiet", COMMIT], check=True)
    tasks = src / "benchmark" / "erpbench100" / "release" / "harbor" / "tasks"
    print(f"{len(list(tasks.glob('erpbench-*')))} tasks from {COMMIT[:7]} "
          f"in {src}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
