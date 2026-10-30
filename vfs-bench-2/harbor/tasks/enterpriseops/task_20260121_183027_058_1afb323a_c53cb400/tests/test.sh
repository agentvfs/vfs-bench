#!/usr/bin/env bash
# Upstream's SQL verifiers on each server's end state, in the workspace
# (grade.py), under WorkspaceVerifier.
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py
