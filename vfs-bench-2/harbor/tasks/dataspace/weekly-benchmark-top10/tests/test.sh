#!/usr/bin/env bash
# Upstream's evaluator on /output/prediction.csv, against the task's gold
# CSV under its frozen config, in MicrosandboxVerifier's VM (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py task_43
