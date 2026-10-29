# Each fund's year-to-date return (mf_netvalueperformancehis), under its
# public code: two rows carry an internal "J" code, which mf_fundarchives
# (joined on InnerCode) gives as the public SecuCode.
python3 - <<'PY'
import csv, sqlite3
from decimal import Decimal, ROUND_HALF_UP
db = sqlite3.connect("/workspace/db/sub_db.sqlite")
public = {str(inner): code for inner, code in db.execute("select InnerCode, SecuCode from mf_fundarchives")}
def rate(text):
    if text == "":
        return ""
    value = format(Decimal(text).quantize(Decimal("1e-10"), rounding=ROUND_HALF_UP).normalize(), "f")
    return value if "." in value else value + ".0"
rows = [(public.get(r["InnerCode"], r["SecuCode"]), r["SecuAbbr"], rate(r["RRSinceThisYear"]))
        for r in csv.DictReader(open("/workspace/csv/mf_netvalueperformancehis.csv", encoding="utf-8"))]
rows.sort(key=lambda r: r[0])
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["基金代码", "基金简称", "今年以来回报率(%)"])
    writer.writerows(rows)
print(len(rows), "rows")
PY

head -5 /output/prediction.csv; grep -n '^50120[67],' /output/prediction.csv
