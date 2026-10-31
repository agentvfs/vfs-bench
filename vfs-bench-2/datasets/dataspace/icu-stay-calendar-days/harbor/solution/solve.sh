#!/usr/bin/env bash
# doc/patient.md, in prose: section I links unit stays to uniquepid
# 008-186, and sections V and VI give each stay's unitadmittime and
# unitdischargetime. Take the earliest stay and count the calendar days
# between the two dates.
python3 - <<'PY'
import csv, re
from datetime import datetime
doc = open("/workspace/doc/patient.md", encoding="utf-8").read()
paragraphs = doc.split("\n\n")
stays = re.findall(r"unit stay \*\*(\d+)\*\*[^\n]*unique patient identifier is \*\*008-186\*\*", doc)
DATE = r"(January|February|March|April|May|June|July|August|September|October|November|December) (\d+)(?:st|nd|rd|th), (\d{4})"
def stamp(stay, field):
    """The date of `field` in the stay's paragraph: the first date after it, else the last before it."""
    for p in paragraphs:
        if f"**{stay}**" in p and f"**{field}**" in p:
            before, after = p.split(f"**{field}**", 1)
            m = re.search(DATE, after) or [*re.finditer(DATE, before)][-1]
            return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date()
times = sorted((stamp(s, "unitadmittime"), stamp(s, "unitdischargetime"), s) for s in stays)
admit, discharge, stay = times[0]
print(stays, stay, admit, discharge)
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["icu_stay_calendar_day_difference"])
    writer.writerow([(discharge - admit).days])
PY

cat /output/prediction.csv
