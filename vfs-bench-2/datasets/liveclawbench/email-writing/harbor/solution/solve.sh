#!/usr/bin/env bash
# Ours, on Mirage's gws fake (vfs-bench-2, rule A): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This writes to Mary with the gws CLI, at the address the instruction gives.
set -euo pipefail

gws gmail send --to mary.lee@work.mosi.inc \
  --subject "Serious bug fixed; time to discuss the new project?" \
  --body "Hi Mary,

The serious BUG you discovered last night has been fixed.

When would you be available to discuss plans for the new project?

Best regards,
Peter" > /dev/null
echo "Oracle: email sent to mary.lee@work.mosi.inc"
