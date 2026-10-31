#!/usr/bin/env bash
# The ten funds with the highest benchmark growth this week
# (mf_benchmarkgrowthrate.BenchGRForThisWeek), keeping every fund tied
# with the tenth in record order, and each one's investment target from
# mf_fundarchives (joined on InnerCode).
python3 - <<'PY'
import csv, json
csv.field_size_limit(1 << 24)
bench = json.load(open("/workspace/json/mf_benchmarkgrowthrate.json", encoding="utf-8"))["records"]
archives = {r["InnerCode"]: r for r in csv.DictReader(open("/workspace/csv/mf_fundarchives.csv", encoding="utf-8"))}
ranked = sorted((b for b in bench if b["BenchGRForThisWeek"] is not None), key=lambda b: -b["BenchGRForThisWeek"])
tenth = ranked[9]["BenchGRForThisWeek"]
rows = []
for b in ranked:
    if b["BenchGRForThisWeek"] < tenth:
        break
    fund = archives[str(b["InnerCode"])]
    rows.append((fund["SecuAbbr"], fund["InvestTarget"]))
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["SecuAbbr", "InvestTarget"])
    writer.writerows(rows)
print(len(rows), "rows")
PY

cut -c1-80 /output/prediction.csv
