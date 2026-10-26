"""Fetch Agent-Diff and Box's API description at pinned commits, and build
the backend image.

    python3 -I agentdiff/setup.py

Clones upstream (MIT) into ``state/agentdiff/src``; its tasks are
``datasets/agent-diff-bench/all_numbered.jsonl`` there. Downloads Box's
OpenAPI descriptions (box/box-openapi, Apache-2.0), the main one and the
2025.0 one that has Box Hubs, which the ``box`` CLI is generated from.
Builds the backend image ``compose.yaml`` runs.
"""
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE.parent / "state" / "agentdiff"
SRC = STATE / "src"
REPO = "https://github.com/agent-diff-bench/agent-diff.git"
COMMIT = "3bb9c40707df23d89e5dbc0e40c424ba38c69ff8"
# The last box-openapi commit before Agent-Diff's.
BOX = ("https://raw.githubusercontent.com/box/box-openapi/"
       "c9a878a9824344129881392e2b08f7117201e82e/")
SPECS = {
    "box-openapi.json": "openapi.json",
    "box-openapi-v2025.0.json": "openapi/openapi-v2025.0.json"
}


def main() -> int:
    if not (SRC / ".git").is_dir():
        STATE.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--quiet", "--filter=blob:none", REPO,
             str(SRC)],
            check=True)
    subprocess.run(
        ["git", "-C", str(SRC), "checkout", "--quiet", COMMIT], check=True)
    for name, path in SPECS.items():
        dest = STATE / name
        if not dest.exists():
            with urllib.request.urlopen(BOX + path) as reply, \
                    open(dest, "wb") as out:
                shutil.copyfileobj(reply, out)
    env = dict(os.environ,
               AGENTDIFF_BACKEND=str(SRC / "backend"),
               AGENTDIFF_HERE=str(HERE),
               AGENTDIFF_SEED="box")
    compose = ["docker", "compose", "-p", "vfsbench-agentdiff-build"]
    subprocess.run(
        [*compose, "-f", str(HERE / "compose.yaml"), "build"],
        env=env,
        check=True)
    print(f"Agent-Diff {COMMIT[:7]} in {SRC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
