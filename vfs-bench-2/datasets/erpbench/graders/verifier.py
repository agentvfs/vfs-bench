"""ERPBench-100's native grading definitions (generate.py writes them): each
task's state-view queries, which its fake answers, its input and the hash of
the file it reads from the task's verifier/."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"


def definitions() -> dict:
    if not MANIFEST.is_file():
        return {}
    return json.loads(MANIFEST.read_text())["tasks"]
