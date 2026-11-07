#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: HR's and IT's emails,
# the onboarding and equipment guides in the KB, both 张伟 contacts and the
# data department (no manager), the equipment stock (MacBook Air out),
# March 9's calendar (the 10:30 Tech Review), then the writes: the
# training event at 15:00, after the conflict and the 14:00 department
# introductions; the notices to the two managers with `gws gmail send`
# (upstream's gmail_send_message), neither naming the data department;
# the data department's notice as a draft to HR; and four follow-up
# todos, the first for the equipment requests, workstations and accounts
# nothing here can arrange, so the notices call them pending.
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
gws gmail read --id msg_2001
gws gmail read --id msg_2002
STEP
step <<'STEP'
kb search --query 入职流程
kb search --query 设备申请
STEP
step <<'STEP'
kb get-article --article-id KB-701
kb get-article --article-id KB-702
STEP
step <<'STEP'
contacts search --query 张伟
contacts search --query 数据部
STEP
step <<'STEP'
inventory list-products
STEP
step <<'STEP'
inventory get-product --product-id EQ-002
STEP
step <<'STEP'
gws calendar events list --params '{"calendarId": "primary", "timeMin": "2026-03-09T00:00:00+08:00", "timeMax": "2026-03-10T00:00:00+08:00", "orderBy": "startTime", "singleEvents": true}'
STEP
step <<'STEP'
gws calendar events insert --params '{"calendarId": "primary"}' --json '{"summary": "新员工入职培训", "description": "王小明、刘晓婷、陈浩然的入职培训。HR建议的10:00-12:00与张伟（工程部）10:30-11:30的Tech Review会议冲突，14:00有部门介绍和市场部的市场策略讨论，故安排在15:00-17:00。", "location": "大会议室", "start": {"dateTime": "2026-03-09T15:00:00+08:00", "timeZone": "Asia/Shanghai"}, "end": {"dateTime": "2026-03-09T17:00:00+08:00", "timeZone": "Asia/Shanghai"}, "attendees": [{"email": "wangfang@company.com"}, {"email": "zhangwei_eng@company.com"}, {"email": "zhangwei_mkt@company.com"}]}'
STEP
step <<'STEP'
gws gmail send --to zhangwei_eng@company.com --subject '新员工入职通知 - 王小明' --body '张伟经理，您好：

工程部的新员工王小明（前端开发工程师）将于下周一（3月9日）入职，请您知悉并做好接待准备：

- 设备：MacBook Pro 14寸，库存充足（8台）。按KB-702需在OA系统提交设备申请并经部门经理审批，申请尚未提交，请您在3月6日前（入职前3天）审批
- 工位：待安排，已请HR落实
- 账号：GitLab账号待IT创建，已请HR跟进
- 日程：9:00 HR接待；15:00-17:00 新员工入职培训（因您10:30-11:30有Tech Review会议，培训从原建议的10:00-12:00调整到下午）；14:00 部门介绍，请您安排

如有其他需要，请回复我或HR王芳。

谢谢！'
STEP
step <<'STEP'
gws gmail send --to zhangwei_mkt@company.com --subject '新员工入职通知 - 刘晓婷' --body '张伟经理，您好：

市场部的新员工刘晓婷（市场专员）将于下周一（3月9日）入职，请您知悉并做好接待准备：

- 设备：MacBook Air目前缺货，预计3月10日到货。按KB-702需登记等候名单、到货后优先分配，并为入职当天申请临时备用设备；这两项申请尚未提交，请您在3月6日前审批
- 工位：待安排，已请HR落实
- 账号：营销工具账号待IT创建，已请HR跟进
- 日程：9:00 HR接待；15:00-17:00 新员工入职培训（避开上午的会议冲突和您14:00-15:00的市场策略讨论）；14:00 部门介绍，请您安排

如有其他需要，请回复我或HR王芳。

谢谢！'
STEP
step <<'STEP'
gmail save-draft --to wangfang@company.com --subject '新员工入职通知 - 陈浩然（数据部，草稿待HR协调）' --body '王芳，您好：

数据部目前没有部门经理（刘洋为资深分析师代管日常工作），按规定陈浩然的入职通知只保存草稿、不直接发送，请HR直接协调：

- 陈浩然，数据部，数据工程师，3月9日入职
- 设备：高配工作站有库存（3台），数据岗位需额外审批，设备申请尚未提交，请HR协调提交
- 工位：待安排
- 权限：数据库访问权限需先通过安全部（赵强）的安全审查，通常1-2个工作日，审查申请尚未提交，入职首日暂不开通
- 日程：9:00 HR接待；15:00-17:00 新员工入职培训；14:00 部门介绍（请协调刘洋）

谢谢！'
STEP
step <<'STEP'
todo create-task --title '提交三位新员工的设备申请、工位和账号安排' --description '按KB-701/702在3月6日前（入职前3天）完成：OA系统提交王小明MacBook Pro、刘晓婷临时备用设备（MacBook Air登记等候名单）、陈浩然高配工作站（需额外审批）的设备申请并取得部门经理审批；请HR安排三人工位；请IT创建GitLab账号和营销工具账号。' --priority high --due-date 2026-03-06 --tags 入职
todo create-task --title '跟进MacBook Air到货 - 刘晓婷' --description 'EQ-002 MacBook Air缺货，预计3月10日到货15台，到货后优先分配给市场部刘晓婷；入职当天先提供临时备用设备。' --priority high --due-date 2026-03-10 --tags 入职
todo create-task --title '跟进陈浩然安全审查' --description '陈浩然（数据部，数据工程师）需通过安全部赵强的安全审查后才能开通数据库访问权限，审查通常1-2个工作日，申请尚未提交，请于今天提交。' --priority high --due-date 2026-03-10 --tags 入职
todo create-task --title '跟进数据部入职通知草稿 - 陈浩然' --description '数据部没有部门经理，陈浩然的入职通知已保存为草稿发给HR王芳，由HR直接协调刘洋安排部门介绍。' --priority medium --due-date 2026-03-06 --tags 入职
STEP
step <<'STEP'
todo list-tasks
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
