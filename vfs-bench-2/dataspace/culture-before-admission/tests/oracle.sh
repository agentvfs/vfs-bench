# Patient 031-3355's current stay (no hospital discharge yet), and whether
# its blood, venipuncture culture was taken before the hospital admission.
python3 - <<'PY'
import csv, sqlite3
db = sqlite3.connect("/workspace/db/sub_db.sqlite")
stay, admitted = db.execute("""select patientunitstayid, hospitaladmittime from patient
                               where uniquepid = '031-3355' and hospitaldischargetime is null""").fetchone()
taken = db.execute("""select culturetakentime from microlab
                      where patientunitstayid = ? and culturesite = 'blood, venipuncture'""", (stay,)).fetchone()[0]
print(stay, admitted, taken)
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["Was collected before admission"])
    writer.writerow(["Yes" if taken < admitted else "No"])
PY

cat /output/prediction.csv
