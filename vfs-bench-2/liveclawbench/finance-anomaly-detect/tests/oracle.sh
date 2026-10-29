# Upstream's solution/solve.sh, through the CLI, with the ids picked from the
# listing by the anomalies its comments name: a charge repeated with the same
# vendor and amount, and large round amounts (whole multiples of $10,000).
finance login --username admin --password admin123

for id in $(finance list-transactions | python3 -c '
import collections, json, sys
rows = json.load(sys.stdin)["data"]
seen = collections.Counter((t["vendor_name"], t["amount"]) for t in rows)
print(" ".join(str(t["id"]) for t in rows if seen[(t["vendor_name"], t["amount"])] > 1 or t["amount"] % 10000 == 0))
'); do finance flag-transaction --id "$id"; done
