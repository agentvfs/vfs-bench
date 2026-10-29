#!/usr/bin/env bash
# Upstream's judge over each app's login and logout and row 26's
# expected environment, in MicrosandboxVerifier's VM (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py 26
