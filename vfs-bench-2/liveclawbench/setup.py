"""Fetch LiveClawBench at its pinned commit and install its mocks.

    python3 -I liveclawbench/setup.py

Clones upstream (MIT) into ``state/liveclawbench/src``, checking out only
``mock-platform/`` and ``tasks/``, and installs the mock platform's
dependencies from its ``bun.lock``.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "state" / "liveclawbench" / "src"
REPO = "https://github.com/Mosi-AI/LiveClawBench.git"
COMMIT = "303dc77ea8d8b6c5b6fc561348b24d13f0c4e448"


def git(*args: str) -> None:
    subprocess.run(["git", "-C", str(SRC), *args], check=True)


def main() -> int:
    if not (SRC / ".git").is_dir():
        SRC.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", "--filter=blob:none",
                        "--no-checkout", REPO, str(SRC)], check=True)
    git("sparse-checkout", "set", "--no-cone", "/mock-platform/", "/tasks/")
    git("checkout", "--quiet", COMMIT)
    subprocess.run(["bun", "install", "--frozen-lockfile"],
                   cwd=SRC / "mock-platform", check=True)
    print(f"LiveClawBench {COMMIT[:7]} in {SRC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
