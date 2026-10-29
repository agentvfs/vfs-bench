#!/usr/bin/env bash
# The task's grader, as upstream's runner runs it (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py T095_pinbench_apm_market_research
