#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: OCR the bulletins (the
# service returns both, combined), then find the Department of the Army
# column of Table 3 in each: FY1940 from April 1948, FY1947 from December
# 1952, which revises it.
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
ls -R /workspace
STEP
step <<'STEP'
ocr-t59 ocr-extract-text --image-path /workspace/fixtures/pdf/treasury_bulletin_1948_04.pdf > /workspace/ocr.json
jq -r .text /workspace/ocr.json > /workspace/ocr.txt
wc -c /workspace/ocr.txt
STEP
step <<'STEP'
grep -n -e '^--- Document' -e 'Table 3.- Expenditures for National Defense' /workspace/ocr.txt
STEP
step <<'STEP'
grep -n -A14 'Table 3.- Expenditures for National Defense' /workspace/ocr.txt | grep -e 'Fiscal year' -e '| 1940 |' -e '| 1947 |'
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
