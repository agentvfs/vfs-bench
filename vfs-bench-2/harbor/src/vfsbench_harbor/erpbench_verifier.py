"""ERPBench-100's native grading definitions (harbor/erpbench.py writes
them): each task's reference hashes, its input and the fake's state-view
queries graders/erpbench.ts reads."""
import json

from vfsbench_harbor.environment import HARBOR

MANIFEST = HARBOR / "graders/erpbench/manifest.json"


def definitions() -> dict:
    if not MANIFEST.is_file():
        return {}
    return json.loads(MANIFEST.read_text())["tasks"]
