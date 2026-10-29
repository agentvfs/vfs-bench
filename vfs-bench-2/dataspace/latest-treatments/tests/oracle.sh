# Patient 025-44842's unit stay is in doc/patient.md; its treatments at the
# latest treatmenttime, in treatmentid order.
python3 - <<'PY'
import csv, re, sqlite3
doc = open("/workspace/doc/patient.md", encoding="utf-8").read()
stays = [int(s) for s in re.findall(r"unit stay ID (\d+) pertains to an individual registered under the unique patient identifier \(uniquepid\) 025-44842\b", doc)]
db = sqlite3.connect("/workspace/db/sub_db.sqlite")
marks = ",".join("?" * len(stays))
latest = db.execute(f"select max(treatmenttime) from treatment where patientunitstayid in ({marks})", stays).fetchone()[0]
rows = db.execute(f"select treatmentname from treatment where patientunitstayid in ({marks}) and treatmenttime = ? order by treatmentid",
                  [*stays, latest]).fetchall()
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["treatmentname"])
    writer.writerows(rows)
print(stays, latest)
PY

cat /output/prediction.csv
