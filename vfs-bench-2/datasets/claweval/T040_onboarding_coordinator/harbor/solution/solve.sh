#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: HR's and IT's emails,
# the onboarding and equipment guides in the KB, both Zhang Wei contacts
# and the Data department (no manager), the equipment stock (MacBook Air
# out), March 9's calendar (the 10:30 Tech Review), then the writes: the
# training event at 15:00, after the conflict and the 14:00 department
# introductions; the notices to the two managers with `gws gmail send`
# (upstream's gmail_send_message), neither naming the Data department;
# the Data department's notice as a draft to HR; and three follow-up
# todos.
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
kb search --query 'onboarding checklist'
kb search --query 'equipment request'
STEP
step <<'STEP'
kb get-article --article-id KB-701
kb get-article --article-id KB-702
STEP
step <<'STEP'
contacts search --query 'Zhang Wei'
contacts search --query Data
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
gws calendar events insert --params '{"calendarId": "primary"}' --json '{"summary": "New employee onboarding training", "description": "Onboarding training for Xiaoming Wang, Xiaoting Liu and Haoran Chen. The 10:00-12:00 slot HR suggested conflicts with Zhang Wei (Engineering)'"'"'s Tech Review Meeting at 10:30-11:30, and 14:00 is the department introduction and Marketing'"'"'s strategy discussion, so the training is at 15:00-17:00.", "location": "Main Conference Room", "start": {"dateTime": "2026-03-09T15:00:00+08:00", "timeZone": "Asia/Shanghai"}, "end": {"dateTime": "2026-03-09T17:00:00+08:00", "timeZone": "Asia/Shanghai"}, "attendees": [{"email": "wangfang@company.com"}, {"email": "zhangwei_eng@company.com"}, {"email": "zhangwei_mkt@company.com"}]}'
STEP
step <<'STEP'
gws gmail send --to zhangwei_eng@company.com --subject 'New Employee Onboarding Notification - Xiaoming Wang' --body 'Hi Zhang Wei,

Xiaoming Wang (Frontend Developer) joins Engineering next Monday, March 9. Please be ready to welcome him:

- Equipment: MacBook Pro 14-inch, in stock, requested per KB-702, for pickup on day one
- Workstation: assigned
- Account: GitLab account is being created
- Schedule: 9:00 HR reception; 15:00-17:00 new employee onboarding training (moved from the suggested 10:00-12:00 because of your Tech Review Meeting at 10:30-11:30); 14:00 department introduction, please arrange it

Reply to me or to Fang Wang in HR if you need anything else.

Thanks!'
STEP
step <<'STEP'
gws gmail send --to zhangwei_mkt@company.com --subject 'New Employee Onboarding Notification - Xiaoting Liu' --body 'Hi Zhang Wei,

Xiaoting Liu (Marketing Specialist) joins Marketing next Monday, March 9. Please be ready to welcome her:

- Equipment: MacBook Air is out of stock until March 10; she is on the waitlist with priority on arrival, and a temporary loaner is arranged for day one
- Workstation: assigned
- Account: marketing tools account is being created
- Schedule: 9:00 HR reception; 15:00-17:00 new employee onboarding training (kept clear of the morning meeting conflict and your Marketing Strategy Discussion at 14:00-15:00); 14:00 department introduction, please arrange it

Reply to me or to Fang Wang in HR if you need anything else.

Thanks!'
STEP
step <<'STEP'
gmail save-draft --to wangfang@company.com --subject 'New Employee Onboarding Notification - Haoran Chen (Data department, draft for HR)' --body 'Hi Fang,

The Data department has no department manager at the moment (Yang Liu, a senior analyst, handles day-to-day operations), so per the policy this onboarding notification for Haoran Chen is saved as a draft, not sent, for HR to coordinate directly:

- Haoran Chen, Data department, Data Engineer, starting March 9
- Equipment: high-performance workstation, in stock, requested (data roles need additional approval)
- Workstation: assigned
- Access: database access permissions require security clearance from the Security department (Qiang Zhao) first, typically 1-2 business days, so they will not be active on day one
- Schedule: 9:00 HR reception; 15:00-17:00 new employee onboarding training; 14:00 department introduction (please coordinate with Yang Liu)

Thanks!'
STEP
step <<'STEP'
todo create-task --title 'Follow up MacBook Air arrival - Xiaoting Liu' --description 'EQ-002 MacBook Air is out of stock; 15 units expected March 10. Allocate one to Xiaoting Liu (Marketing) on arrival; provide a temporary loaner on day one.' --priority high --due-date 2026-03-10 --tags onboarding
todo create-task --title 'Follow up security clearance - Haoran Chen' --description 'Haoran Chen (Data, Data Engineer) needs security clearance from Qiang Zhao in Security before database access can be granted; clearance takes 1-2 business days, submit before the start date.' --priority high --due-date 2026-03-10 --tags onboarding
todo create-task --title 'Follow up Data department onboarding draft - Haoran Chen' --description 'The Data department has no manager; the onboarding notification for Haoran Chen is saved as a draft to Fang Wang in HR, who coordinates the department introduction with Yang Liu.' --priority medium --due-date 2026-03-06 --tags onboarding
STEP
step <<'STEP'
todo list-tasks
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
