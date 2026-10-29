#!/usr/bin/env bash
# Upstream's rubric on the world the trial's run of the fake ends with (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py
