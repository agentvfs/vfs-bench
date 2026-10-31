#!/usr/bin/env bash
# doc/ed_grossdomesticproduct.md is prose. Each record (战略单元/档案 N)
# comes up three times, in order: the region and period, the GDP, then the
# three industries. Regions are named in full, by short name, or as 首都;
# a period without a year continues the one before; draft figures (曾,
# 早期, 初步, 误报) are dropped, and an amount belongs to the industry its
# clause, or the one before it, names first. Records come out in the
# order they first appear.
python3 - <<'PY'
import csv, re
doc = open("/workspace/doc/ed_grossdomesticproduct.md", encoding="utf-8").read()
REGIONS = ("北京市 天津市 上海市 重庆市 河北省 山西省 辽宁省 吉林省 黑龙江省 江苏省 浙江省 安徽省 福建省 江西省 山东省 "
           "河南省 湖北省 湖南省 广东省 海南省 四川省 贵州省 云南省 陕西省 甘肃省 青海省 台湾省 内蒙古自治区 "
           "广西壮族自治区 西藏自治区 宁夏回族自治区 新疆维吾尔自治区 广州市 深圳市").split()
ALIAS = {"首都": "北京市"}
for r in REGIONS:
    ALIAS[r] = ALIAS[re.sub(r"(壮族|回族|维吾尔)?(自治区|省|市)$", "", r)] = r
ALIAS_RE = "|".join(sorted(map(re.escape, ALIAS), key=len, reverse=True))
SECTOR = {"第一产业": 1, "第二产业": 2, "第三产业": 3, "工业": 2, "服务业": 3}
DRAFT = re.compile(r"曾|早期|初步|误报")
records = {}
for para in doc.split("\n"):
    m = re.search(r"(?:战略单元|战略档案|档案|单元|记录)\s*(\d+(?:\s*(?:、|和)\s*\d+)*)", para)
    for rid in re.findall(r"\d+", m.group(1)) if m else []:
        records.setdefault(rid, []).append(para)
def amounts(para):
    """(industry, value) for each amount in 亿元 that is not a draft figure."""
    out = []
    for sentence in para.split("。"):
        sector = None
        for clause in sentence.split("，"):
            named = [SECTOR[s] for s in re.findall("|".join(SECTOR), clause)]
            values = re.findall(r"(\d+(?:\.\d+)?)亿元", clause)
            sector = named[0] if named else sector
            if values and not DRAFT.search(clause):
                out += zip(named, values) if "分别" in clause else [(sector, v) for v in values]
    return out
rows, year = [], None
for rid, (where, gdp, industries) in records.items():
    region = next(ALIAS[m.group(0)] for p in (where, gdp, industries) for m in [re.search(ALIAS_RE, p)] if m)
    years = re.findall(r"(\d{4})年12月31日", where) or re.findall(r"(\d{4})财?年", where)
    year = years[-1] if years else year
    [(_, total)] = amounts(gdp)
    parts = dict(amounts(industries))
    rows.append((region, f"{year}-12-31", total, parts.get(1, ""), parts.get(2, ""), parts.get(3, "")))
with open("/output/prediction.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["Province", "EndDate", "GDP（亿元）", "PrimaryIndustryGDP（亿元）", "SecondIndustryGDP（亿元）", "ThirdIndustryGDP（亿元）"])
    writer.writerows(rows)
print(len(rows), "records")
PY

cat /output/prediction.csv
