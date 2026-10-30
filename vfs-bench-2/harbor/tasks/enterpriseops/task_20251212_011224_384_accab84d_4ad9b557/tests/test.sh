#!/usr/bin/env bash
# Upstream's SQL verifiers on each server's end state (grade.py), in
# MicrosandboxVerifier's VM; MirageVerifier runs its native port instead.
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py
