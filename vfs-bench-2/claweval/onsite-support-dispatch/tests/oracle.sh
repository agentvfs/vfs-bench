# Upstream's reference_solution, through the CLIs: read the tickets, the VIP
# customer and their email, the three technicians' skills and schedules,
# then save (not send) the dispatch notifications as drafts.
helpdesk list-tickets

helpdesk get-ticket --ticket-id TK-1201

crm get-customer --customer-id CUS-1201

gmail list-messages

gmail get-message --message-id msg_1201

contacts search --query engineer

contacts get --contact-id CT-1201
contacts get --contact-id CT-1202
contacts get --contact-id CT-1203

calendar get-user-events --user 'Ma Qiang' --date 2026-03-26
calendar get-user-events --user 'Li Hua' --date 2026-03-26
calendar get-user-events --user 'Zhou Ming' --date 2026-03-26

contacts search --query 'Zhao Lei'
contacts search --query 'Wang Ming'

gmail save-draft --to 'maqiang@company.com, wangming@company.com' --subject 'URGENT onsite dispatch: TK-1201 Wantong Logistics production outage (SLA deadline 14:15)' --body 'Hi Ma Qiang,
You are dispatched onsite to Wantong Logistics (CUS-1201, VIP, platinum SLA) for ticket TK-1201, a critical, complete production system outage.
Customer: Wantong Logistics, General Manager Wang (13900121001), Zhangjiang Hi-Tech Park, Shanghai Pudong New Area.
Problem: the production ERP system has been down since 10:00; a service restart did not help; the logs show the database connection pool exhausted, suspected primary database node failure. 200+ employees cannot work and logistics dispatch is halted.
SLA: 4-hour onsite response. The ticket was created at 10:15, so you must be onsite by 14:15; the customer asks for arrival before 2:00 PM.
Arrangement: please leave as soon as your morning meetings end at 12:00, to be onsite before 2:00 PM. Bring database diagnostic tools and failover runbooks for the primary node.
Backup: Li Hua will support remotely and can go onsite if you are delayed.
Wang Ming is copied as technical director for the escalation.
Thanks'

gmail save-draft --to 'zhaolei@company.com, wangming@company.com' --subject 'Wantong Logistics TK-1201: Ma Qiang dispatched onsite before 14:15' --body 'Hi Zhao Lei,
For your VIP account Wantong Logistics (CUS-1201): we have dispatched Ma Qiang, Senior Operations Engineer (system troubleshooting, database operations), to their Shanghai Pudong office for TK-1201, the complete production system outage (database connection pool exhausted, suspected primary node failure).
He will arrive before the 4-hour SLA deadline of 14:15 (the customer asked for 2:00 PM in their email). Li Hua is the backup, supporting remotely. Zhou Ming is in Shenzhen all day and is unavailable.
Please confirm the dispatch with General Manager Wang. Wang Ming is copied for the escalation of this critical VIP ticket.
Thanks'
