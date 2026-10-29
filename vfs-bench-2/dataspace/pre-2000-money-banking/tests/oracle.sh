# The money and banking survey (json/ed_chinamoneyandbanking.json) before
# 2000, where both net foreign assets and domestic credit are reported,
# keeping one copy of each exactly repeated (date, values) row.
python3 - <<'PY'
import csv, json
records = json.load(open("/workspace/json/ed_chinamoneyandbanking.json", encoding="utf-8"))["records"]
seen, rows = set(), []
for r in records:
    if r["EndDate"] < "2000" and r["NetAbroadAssets"] is not None and r["DomesticLoans"] is not None:
        row = (r["EndDate"], r["NetAbroadAssets"], r["DomesticLoans"])
        if row not in seen:
            seen.add(row)
            rows.append(row)
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["EndDate", "NetAbroadAssets", "DomesticLoans"])
    writer.writerows(rows)
print(len(rows), "rows")
PY

cat /output/prediction.csv
