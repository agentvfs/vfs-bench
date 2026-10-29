#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it finds
# the stale thread at /gmail and escalates with the gws CLI, where upstream's
# logs in to the email mock and posts to its REST API.
set -euo pipefail

# BlueHarbor's contract redline has waited since 2026-04-01 with no reply.
grep -l "procurement@blueharbor.example.com" /gmail/INBOX/*/*.gmail.json > /dev/null

# Send escalation email
gws gmail send --to ops@work.mosi.inc \
  --subject "Escalation: BlueHarbor Labs -- stale > 48h" \
  --body "Heads up -- BlueHarbor Labs has been waiting since 2026-04-01 on contract redline blocked by missing DPA. No reply has gone out from our side. Flagging for ops follow-up." > /dev/null
echo "Oracle: escalation email to ops"

# Append log entry (preserve existing lines)
python3 <<'PY'
from pathlib import Path
p = Path("/workspace/notes/client-escalation-log.md")
content = p.read_text() if p.exists() else "# Client Escalation Log\n"
new_line = "- 2026-04-03 — BlueHarbor Labs — contract redline blocked by missing DPA."
if new_line not in content:
    p.write_text(content.rstrip() + "\n" + new_line + "\n")
print("Oracle: log entry appended")
PY
