#!/usr/bin/env bash
# Ours, on Mirage's gws fake (vfs-bench-2, rule A): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This looks for parrot.ai's email at /gmail and, if it has come, replies to
# it with the gws CLI.
set -euo pipefail

# The email from a parrot.ai address: its id, its sender's name and its
# subject, one per line.
FOUND=$(python3 <<'PY'
import glob
import json

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if "parrot" in mail["from"]["email"].rpartition("@")[2].lower():
        name = mail["from"]["name"].split(".")[0].strip('"').title()
        print(mail["id"], name, mail["subject"], sep="\n")
        break
PY
)
if [ -z "$FOUND" ]; then
  echo "Oracle: no email from parrot.ai yet"
  exit 0
fi
ID=$(echo "$FOUND" | sed -n 1p)
NAME=$(echo "$FOUND" | sed -n 2p)
SUBJECT=$(echo "$FOUND" | sed -n 3p)

gws gmail reply --message-id "$ID" --body "Hi $NAME,

Thank you for your email ($SUBJECT). We have received your requirements and will handle them properly; we will get back to you soon.

Best regards,
Peter" > /dev/null
echo "Oracle: replied to $NAME's email ($ID)"
