"""Fetch Blobfish's ERPBench-100 at its pinned commit.

    uv run --project datasets/erpbench python -I datasets/erpbench/fetch.py

Clones blobfishai/erp-agent-simulation (code Apache-2.0, data CC BY 4.0)
into ``state/erpbench/src``; its Harbor release,
``benchmark/erpbench100/release/harbor/tasks/erpbench-NNN/``, is what
``generate.py`` reads. Then it runs ``generate.py``, which writes the files
not committed: each task's ``task.json`` and solution, and the fake's kits
in ``state/erpbench/kit/``. Upstream's world and grader are stdlib Python.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE.parents[1] / "state" / "erpbench"
REPO = "https://github.com/blobfishai/erp-agent-simulation.git"
COMMIT = "5bdf458165fee71f6a7965ea30ca33dfbbce1332"


def main() -> int:
    src = STATE / "src"
    if not (src / ".git").is_dir():
        STATE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", REPO, str(src)], check=True)
    subprocess.run(
        ["git", "-C", str(src), "checkout", "--quiet", COMMIT], check=True)
    print(f"ERPBench-100 {COMMIT[:7]} in {src}")
    return subprocess.run([sys.executable, "-I",
                           str(HERE / "generate.py")]).returncode


if __name__ == "__main__":
    raise SystemExit(main())
