"""Fetch ComplexMCP at its pinned commit and export its tasks.

    uv run --project complexmcp python -I complexmcp/setup.py

Clones upstream into ``state/complexmcp/src`` (MIT) and writes its 47
tasks from ``benchmark/data/data.parquet`` to ``state/complexmcp/tasks.json``
so the TypeScript side can read them.
"""
import json
import subprocess
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "state" / "complexmcp"
REPO = "https://github.com/ATH-MaaS/complex-mcp.git"
COMMIT = "7c01f92e38be6e0c193d5c6c9a55baa92fb628cb"


def main() -> int:
    src = STATE / "src"
    if not (src / ".git").is_dir():
        STATE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", REPO, str(src)], check=True)
    subprocess.run(
        ["git", "-C", str(src), "checkout", "--quiet", COMMIT], check=True)
    rows = pq.read_table(src / "benchmark" / "data" /
                         "data.parquet").to_pylist()
    tasks = [{
        "index": index,
        "seed": int(row["seed"]),
        "query": row["query"],
        "apps": json.loads(row["apps"]),
        "level": int(row["level"]),
        "tool_cnt": json.loads(row["tool_cnt"]),
        "gt_env": json.loads(row["gt_env"]),
    } for index, row in enumerate(rows)]
    (STATE / "tasks.json").write_text(
        json.dumps(tasks, indent=1, ensure_ascii=False))
    print(f"{len(tasks)} tasks from {COMMIT[:7]} in {STATE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
