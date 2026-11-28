#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: list the inbox and read
# all nine messages, then summarize the seven Project Alpha emails in the
# reply (budget, timeline, security and architecture risks, client
# pipeline) and leave the two noise emails out of it. Nothing is sent.
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
for id in pb18_001 pb18_002 pb18_003 pb18_004 pb18_005 pb18_006 pb18_007 pb18_008 pb18_009; do
  gws gmail read --id "$id"
done
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
