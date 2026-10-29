# doc/lc_stockarchives.md gives each archive's CompanyCode (the final,
# corrected one, which is the paragraph's last bold value) and, for the
# companies it locates, the registered province (the first bold name in
# its location paragraph). Count lc_sharestru records with over 200
# million non-listed A shares (NonListedShares) per province.
python3 - <<'PY'
import csv, re, sqlite3
from collections import Counter
doc = open("/workspace/doc/lc_stockarchives.md", encoding="utf-8").read()
codes_part = doc.split("在完成了对公司内部编码体系的审查后")[0]
location_part = doc.split("### 公司地理位置与区域经济关联性分析")[1].split("\n### ")[0]
code = {}
for para in codes_part.splitlines():
    bold = re.findall(r"\*\*(.+?)\*\*", para)
    if len(bold) >= 2 and bold[0].isdigit():
        code[bold[0]] = int(bold[-1])
province = {}
for para in location_part.splitlines():
    bold = re.findall(r"\*\*(.+?)\*\*", para)
    if bold and bold[0].isdigit():
        province[code[bold[0]]] = next(b for b in bold[1:] if not b.isdigit())
db = sqlite3.connect("/workspace/db/sub_db.sqlite")
counts = Counter(province[c] for c, n in db.execute("select CompanyCode, NonListedShares from lc_sharestru")
                 if c in province and n is not None and n > 2e8)
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["注册省份", "股本结构变动记录数"])
    writer.writerows(sorted(counts.items()))
print(len(code), "codes,", len(province), "located")
PY

cat /output/prediction.csv
