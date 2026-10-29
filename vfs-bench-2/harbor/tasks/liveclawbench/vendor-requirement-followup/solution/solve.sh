#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it finds
# the vendor's summary at /gmail and replies to it with the gws CLI, where
# upstream's logs in to the email mock and posts to its REST API.
set -euo pipefail

# Orchid Systems' requirement summary arrived today.
SUMMARY=$(grep -l "ops@orchid-systems.com" /gmail/INBOX/*/*.gmail.json)
ID=$(basename "$SUMMARY" .gmail.json | sed 's/.*__//')

# Send acknowledgement reply
gws gmail reply --message-id "$ID" --body "Hi,

Thanks for the summary -- received and we will review it this week. Will follow up with questions if any.

Peter" > /dev/null
echo "Oracle: reply sent to ops@orchid-systems.com"

# Update tracker line in place, preserving the other two entries
python3 <<'PY'
from pathlib import Path
p = Path("/workspace/notes/requirements-tracker.md")
content = p.read_text()
target_old = "- Phoenix Analytics pilot API scope — awaiting latest summary"
target_new = "- Phoenix Analytics pilot API scope — received 2026-04-03"
if target_old in content:
    p.write_text(content.replace(target_old, target_new))
    print("Oracle: tracker line updated")
else:
    p.write_text(content.rstrip() + "\n" + target_new + "\n")
    print("Oracle: target line not found; appended instead")
PY
