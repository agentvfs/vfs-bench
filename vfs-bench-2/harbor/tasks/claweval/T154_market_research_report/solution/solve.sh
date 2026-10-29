#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: the CEO's request and the
# VP's feedback, the 8 relevant RSS articles (of 15), the 5 KB analyses and
# the 8 CRM customers, then the executives' addresses and a draft (not sent)
# of the report email to them.
# Mail and events are read through the /gmail mount and the gws CLI, as
# the instruction gives them; drafts are upstream's tool (gmail save-draft).
# Each step's command and output go to the trajectory (trajectory.py),
# which ends with reply.md.
S=/tmp/oracle
mkdir -p "$S"
n=0
step() {
  n=$((n + 1))
  cat > "$S/$n.cmd"
  sh "$S/$n.cmd" > "$S/$n.out" 2>&1
  cat "$S/$n.out"
}
step <<'STEP'
ls -R /gmail/INBOX
STEP
step <<'STEP'
gws gmail read --id msg_1201
gws gmail read --id msg_1202
STEP
step <<'STEP'
rss list-articles
STEP
step <<'STEP'
rss get-article --article-id RSS-1201
rss get-article --article-id RSS-1202
rss get-article --article-id RSS-1203
rss get-article --article-id RSS-1204
rss get-article --article-id RSS-1205
rss get-article --article-id RSS-1206
rss get-article --article-id RSS-1207
rss get-article --article-id RSS-1208
STEP
step <<'STEP'
kb search --query 'market analysis'
STEP
step <<'STEP'
kb search --query 'competitiveness strategy customer profile sales'
STEP
step <<'STEP'
kb get-article --article-id KB-1201
kb get-article --article-id KB-1202
kb get-article --article-id KB-1203
kb get-article --article-id KB-1204
kb get-article --article-id KB-1205
STEP
step <<'STEP'
crm list-customers
STEP
step <<'STEP'
crm get-customer --customer-id CUS-1201
crm get-customer --customer-id CUS-1202
crm get-customer --customer-id CUS-1203
crm get-customer --customer-id CUS-1204
crm get-customer --customer-id CUS-1205
crm get-customer --customer-id CUS-1206
crm get-customer --customer-id CUS-1207
crm get-customer --customer-id CUS-1208
STEP
step <<'STEP'
contacts search --query Management
STEP
step <<'STEP'
gmail save-draft --to 'zhangceo@company.com, licto@company.com, wangcmo@company.com, zhaovp@company.com' --subject 'Q1 2026 Market Research Report: AI, healthcare policy and renewal risk' --body 'Dear CEO Zhang, CTO Li, CMO Wang and VP Zhao,
Please find below the summary of the Q1 2026 market research report requested by Director Zhang. The full report follows separately.
Key findings
1. AI is accelerating, and manufacturing is our biggest opportunity. Enterprise AI tools grew 120% in Q1 and manufacturing digital investment is up 35%. Our 3 manufacturing customers (2 VIP) are asking for AI quality inspection and predictive maintenance, and Dingsheng Machinery (VIP, renewal due 2026-12-31) is evaluating Competitor A. Our AI lags competitors; the AI analytics assistant is planned for Q2.
2. Healthcare IT is growing on policy. All Tier-A hospitals must upgrade core systems by 2027, a market of over 50B CNY, with strong hybrid cloud demand. Healthcare grew 35% for us in 2025 and renewed 100% in Q1; Renhe Hospital Group (VIP) has expansion potential.
3. Renewal risk is rising. Industry NRR fell from 118% to 109% and SME churn is 22%. Our Q1 renewal rate is 85% (down 3%), standard customers renew at 78%, and education lost 2 customers in Q1, including Mingyuan University on our books.
Recommendations
- Bring the Q2 AI launch forward and pilot AI quality inspection with Huarui Precision and Dingsheng Machinery to protect the Dingsheng renewal.
- Build a healthcare edition with HIS/EMR integration and hybrid cloud deployment, starting with Renhe and Kangning.
- Strengthen customer success for standard and education customers: early-warning on the churn indicators and a lightweight education edition.
- Keep using our Level-3 security certification as the moat in finance, where Xinda Financial Holdings is our largest customer.
Happy to walk through the details at your convenience.
Best regards,
Market Research Team'
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
