"""Grade one LiveClawBench run with the task's own verifier.

Reads ``{"verify", "env"}`` on stdin: the task's ``tests/verify.py`` and the
mocks' database paths, the environment upstream's task image gives it. Runs
the verifier unchanged, from ``/workspace``'s stand-in, and prints its score
(the ``Score: X/1.0`` line upstream's ``test.sh`` reads) and its
``PASS:``/``FAIL:`` lines.
"""
import json
import os
import re
import subprocess
import sys
import tempfile


def main() -> int:
    data = json.load(sys.stdin)
    env = {**os.environ, **data["env"]}
    with tempfile.TemporaryDirectory() as cwd:
        done = subprocess.run([sys.executable, "-I", data["verify"]],
                              cwd=cwd,
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
