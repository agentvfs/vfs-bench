# Upstream's reference_solution, through the CLIs: the projects' meetings in
# the week up to today (2026-03-24), their minutes' action items, every todo,
# and each owner's contact details.
calendar list-events --date 2026-03-17 --days 8

calendar get-event --event-id evt_601
calendar get-event --event-id evt_602
calendar get-event --event-id evt_603
calendar get-event --event-id evt_604
calendar get-event --event-id evt_605
calendar get-event --event-id evt_606

notes list

notes get --note-id NOTE-601
notes get --note-id NOTE-602
notes get --note-id NOTE-603
notes get --note-id NOTE-604
notes get --note-id NOTE-605

todo list-tasks

contacts search --query 王明
contacts search --query 李华
contacts search --query 马强
contacts search --query 赵蕾
contacts search --query 张伟
contacts search --query 周明
