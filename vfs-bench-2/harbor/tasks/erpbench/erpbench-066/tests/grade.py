"""Grade an ERPBench trial with upstream's own grader (tests/verify.py).

Upstream's world service writes the evidence its grader reads: the world
as seeded, the world now, and every call. Here the world is the run's
database (the fake's ``state:``, copied into the workspace before the
verifier runs), and its calls the fake's ``_trace`` table, each entry as
upstream's ``ErpWorld._record`` makes it; the seeded world is upstream's
own ``ErpWorld.create``. Then ``verify.py`` runs as it is.
"""
import json
import os
import runpy
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = Path("/var/lib/mock-data/erpbench/erpbench.db")
sys.path.insert(0, str(HERE))

from erpbench100.world import ErpWorld  # noqa: E402

task = json.loads((HERE / "task.json").read_text())
scratch = Path(tempfile.mkdtemp(prefix="erpbench-grade-"))
seeded = ErpWorld.create(task, scratch / "seeded.sqlite")
baseline = seeded.snapshot()
seeded.close()
world = ErpWorld(task, sqlite3.connect(STATE))
snapshot = world.snapshot()
trace = [
    json.loads(entry)
    for (entry,
         ) in world.connection.execute("SELECT entry FROM _trace ORDER BY idx")
]
world.close()
evidence = scratch / "evidence.json"
evidence.write_text(
    json.dumps({
        "baseline": baseline,
        "snapshot": snapshot,
        "trace": trace
    }))
os.environ["ERPBENCH_EVIDENCE_PATH"] = str(evidence)
runpy.run_path(str(HERE / "verify.py"), run_name="__main__")
