#!/usr/bin/env bash
# Upstream's judge on the trial's event log and answer (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py
