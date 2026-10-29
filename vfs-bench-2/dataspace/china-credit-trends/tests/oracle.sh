# doc/中国金融机构人民币信贷收支表.pdf is prose about numbered records
# (档案/记录 N). A record's first passage gives its period end, and the
# passage naming 单位存款/企业存款 gives its deposits; 财政性存款 comes first
# where a sentence lists it with 机关团体存款 (分别...). Keep the 2004
# records, by period end.
python3 - <<'PY'
import csv, re
import pymupdf
text = "".join(page.get_text() for page in pymupdf.open("/workspace/doc/中国金融机构人民币信贷收支表.pdf")).replace("\n", "")
marks = list(re.finditer(r"(?:档案|记录|文件|条目)\s*(\d+)", text))
def amount(passage, item):
    """The first amount after `item`."""
    return re.search(item + r"\D*?(-?\d[\d,]*(?:\.\d+)?)", passage).group(1).replace(",", "")
end, deposits = {}, {}
for mark, nxt in zip(marks, marks[1:] + [None]):
    rid, passage = mark.group(1), text[mark.start():nxt.start() if nxt else len(text)]
    dates = re.findall(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", passage)
    if rid not in end and dates:
        y, m, d = dates[-1]
        end[rid] = f"{y}-{int(m):02d}-{int(d):02d}"
    if "单位存款/企业存款" in passage and rid not in deposits:
        deposits[rid] = (amount(passage, "单位存款/企业存款"), amount(passage, "财政性存款"))
rows = sorted((end[r], *deposits[r]) for r in deposits if end.get(r, "").startswith("2004"))
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["EndDate", "单位存款/企业存款", "财政性存款"])
    writer.writerows(rows)
PY

cat /output/prediction.csv
