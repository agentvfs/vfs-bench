#!/usr/bin/env bash
# The task's grader, as upstream's runner runs it (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py T119zh_inventory_cost_analysis
