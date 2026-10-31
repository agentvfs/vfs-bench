"""EnterpriseOps-Gym's native grading definitions (harbor/enterpriseops.py
writes them): each task's verifier queries, which its fakes answer in their
state view, and the hashes of the files it reads from the task's verifier/."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"


def definitions() -> dict:
    if not MANIFEST.is_file():
        return {}
    return json.loads(MANIFEST.read_text())["tasks"]
