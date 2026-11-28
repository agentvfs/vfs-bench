#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: list the inbox and read
# all 13 messages, then triage them in the reply: the outage and its alert
# P0, BigClient P1, newsletters and promotions P4. Nothing is sent.
# Mail is read through the /gmail mount and the gws CLI, as the
# instruction gives them. Each step's command and output go to the
# trajectory (trajectory.py), which ends with reply.md.
S=/tmp/oracle
mkdir -p "$S"
n=0
step() {
  n=$((n + 1))
  cat > "$S/$n.cmd"
  sh "$S/$n.cmd" > "$S/$n.out" 2>&1
  cat "$S/$n.out"
}
step <<'STEP'
ls -R /gmail/INBOX
STEP
step <<'STEP'
for id in pb17_001 pb17_002 pb17_003 pb17_004 pb17_005 pb17_006 pb17_007 pb17_008 pb17_009 pb17_010 pb17_011 pb17_012 pb17_013; do
  gws gmail read --id "$id"
done
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
