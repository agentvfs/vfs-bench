"""Grade one LiveClawBench run with the task's own verifier.

Reads ``{"verify", "env", "paths"}`` on stdin: the task's ``tests/verify.py``,
the environment upstream's task image gives it (the mocks' database paths),
and each fixed path upstream's image keeps a mock's file at, mapped to this
run's. Many verifiers name those fixed paths (``/var/lib/mock-data/...``,
``/tmp/mosi_shop_*.json``) rather than read them from the environment, and
write their reward files to ``/logs/verifier``. So this runs a copy of the
verifier with each of those paths replaced by the run's, and nothing else
changed, from ``/workspace``'s stand-in. It prints the verifier's score (the
``Score: X/1.0`` line upstream's ``test.sh`` reads) and its
``PASS:``/``FAIL:`` lines.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    data = json.load(sys.stdin)
    env = {**os.environ, **data["env"]}
    with tempfile.TemporaryDirectory() as root:
        workspace = Path(root, "workspace")
        tests = Path(root, "tests")
        logs = Path(root, "logs", "verifier")
        for d in (workspace, tests, logs):
            d.mkdir(parents=True)
        paths = {**data["paths"], "/logs/verifier": str(logs)}
        source = Path(data["verify"]).read_text()
        # Longest first, so no path is replaced inside a longer one.
        for fixed in sorted(paths, key=len, reverse=True):
            source = source.replace(fixed, paths[fixed])
        verify = tests / "verify.py"
        verify.write_text(source)
        done = subprocess.run(
            [sys.executable, "-I", str(verify)],
            cwd=workspace,
            env=env,
            capture_output=True,
            text=True,
            timeout=900)
    out = done.stdout + done.stderr
    scores = re.findall(r"Score:\s*([0-9.]+)", out)
    score = float(scores[-1]) if scores else 0.0
    lines = re.findall(r"^\s*(PASS|FAIL|ERROR):\s*(.*)$", out, re.MULTILINE)
    results = [
        dict(passed=kind == "PASS", message=text) for kind, text in lines
    ]
    print(json.dumps({"score": score, "results": results, "output": out}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
