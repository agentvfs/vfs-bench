"""EnterpriseOps-Gym's native grading definitions (harbor/enterpriseops.py
writes them): each task's verifier queries, which its fakes answer in their
state view, and the hashes of the reference tests the native port matches."""
import json

from vfsbench_harbor.environment import HARBOR

MANIFEST = HARBOR / "graders/enterpriseops/manifest.json"


def definitions() -> dict:
    if not MANIFEST.is_file():
        return {}
    return json.loads(MANIFEST.read_text())["tasks"]
