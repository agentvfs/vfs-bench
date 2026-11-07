#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: search the knowledge base
# for the observability vendors and trends, read the six articles, and give
# the executive summary, the competitor profiles and the comparison table
# in the reply. Nothing is updated. Each step's command and output go to
# the trajectory (trajectory.py), which ends with reply.md.
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
kb search --query "observability APM market" --max-results 10
STEP
step <<'STEP'
kb get-article --article-id pb19_001
kb get-article --article-id pb19_002
kb get-article --article-id pb19_003
kb get-article --article-id pb19_004
kb get-article --article-id pb19_005
kb get-article --article-id pb19_006
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
