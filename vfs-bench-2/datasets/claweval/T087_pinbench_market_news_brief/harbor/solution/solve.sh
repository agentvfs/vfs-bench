#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: list the feed, read the
# AI and cloud articles (GPT-5, Kubernetes 1.32, RAG) and brief them in the
# reply. Each step's command and output go to the trajectory
# (trajectory.py), which ends with reply.md.
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
rss list-articles --max-results 20
STEP
step <<'STEP'
rss get-article --article-id rss_001
rss get-article --article-id rss_003
rss get-article --article-id rss_007
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
