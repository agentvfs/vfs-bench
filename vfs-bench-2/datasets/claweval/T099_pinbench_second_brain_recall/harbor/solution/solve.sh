#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: list the notes, read the
# stored memory note and answer the five questions from it in the reply.
# Each step's command and output go to the trajectory (trajectory.py),
# which ends with reply.md.
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
notes list
STEP
step <<'STEP'
notes get --note-id mem_001
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
