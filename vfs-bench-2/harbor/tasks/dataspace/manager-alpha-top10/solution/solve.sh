#!/usr/bin/env bash
# The ten fund-manager performance records (mf_fmperfanalysis) with the
# highest annualized alpha.
python3 - <<'PY'
import csv, sqlite3
db = sqlite3.connect("/workspace/db/sub_db.sqlite")
rows = db.execute("""select ChineseName, FundTypeName, IndexCycle, AnnAlphaCoef from mf_fmperfanalysis
                     where AnnAlphaCoef is not null order by AnnAlphaCoef desc limit 10""").fetchall()
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["ChineseName", "FundTypeName", "IndexCycle", "AnnAlphaCoef"])
    writer.writerows(rows)
PY

cat /output/prediction.csv
