#!/usr/bin/env bash
# Ours, on Mirage's gws fake (vfs-bench-2, rule A): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This thanks John for the proposal he sent (at /gmail), sends with the gws
# CLI, and checks /gmail/SENT, sending again until the email is there.
set -euo pipefail

TO=john.smith@gmail.com
SUBJECT="Follow-up on Project Proposal"

# John's proposal email, whose subject the message names.
PROPOSAL=$(python3 <<PY
import glob
import json

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if mail["from"]["email"] == "$TO" and "proposal" in mail["subject"].lower():
        print(mail["subject"])
        break
PY
)

# Whether the email is in the sent folder.
in_sent() {
  grep -rlF "\"subject\":\"$SUBJECT\"" /gmail/SENT > /dev/null 2>&1
}

for attempt in 1 2 3; do
  gws gmail send --to "$TO" --subject "$SUBJECT" --body "Hi John,

Thank you for the project proposal${PROPOSAL:+ (\"$PROPOSAL\")}; I appreciate the work that went into it.

Could we meet next week to discuss it in detail? Let me know which day suits you.

Best regards,
Peter" > /dev/null
  if in_sent; then
    echo "Oracle: the email is in the sent folder (attempt $attempt)"
    exit 0
  fi
  echo "Oracle: the email is not in the sent folder; sending again"
done
echo "Oracle: the email never reached the sent folder" >&2
exit 1
