# doc/其他存款性公司资产负债表.pdf is prose, one section per balance-sheet
# item. In the reserve assets section, each record's total is the first
# amount after "储备资产", or the amount just before "元的储备资产" where a
# sentence sums up its parts. Draft figures quoted in passing are for the
# deposit and cash parts, not the total.
python3 - <<'PY'
import csv, re
import pymupdf
text = "".join(page.get_text() for page in pymupdf.open("/workspace/doc/其他存款性公司资产负债表.pdf")).replace("\n", "")
section = text.split("储备资产。通过对储备资产")[1].split("在审视了构成机构流动性基石的储备资产之后")[0]
AMOUNT = r"(\d[\d,]*(?:\.\d+)?)元"
rows = []
for sentence in section.split("。"):
    m = re.search(r"储备资产[^。\d]*?" + AMOUNT, sentence) or re.search(AMOUNT + r"的储备资产", sentence)
    if m:
        rows.append(m.group(1).replace(",", ""))
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["储备资产"])
    writer.writerows([r] for r in rows)
print(len(rows), "records")
PY

cat /output/prediction.csv
