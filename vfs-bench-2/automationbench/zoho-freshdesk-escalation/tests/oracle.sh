# Read the escalation policy, the Zoho tickets and contacts, and what is
# already in Freshdesk.
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_escalation_policy

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_escalation_policy/values:batchGet --params '{"ranges": ["Escalation Criteria", "Priority Mapping", "Override Rules"]}'

api fetch --method GET --url https://desk.zoho.com/api/v1/tickets

api fetch --method GET --url https://desk.zoho.com/api/v1/contacts

api fetch --method GET --url https://yoursubdomain.freshdesk.com/api/v2/tickets
api fetch --method GET --url https://yoursubdomain.freshdesk.com/api/v2/contacts

# Escalated and Re-Opened tickets qualify, except do-not-escalate (zd_804,
# zd_809, zd_814) and the auto-resolved tag (zd_816). zd_815 is Open but
# enterprise-sla, so it always escalates. Priority maps High 3, Medium 2,
# Low 1; analytics.co (zd_802) and fasttrack.io (zd_811) get at least 3.
# Freshdesk already has "L2 Escalation: Data corruption in exports", so
# zd_801 and zd_807, both that subject, go on it as notes, not new tickets.
escalate() { cid=$(api fetch --method POST --url https://yoursubdomain.freshdesk.com/api/v2/contacts --body "{\"name\": \"$3\", \"email\": \"$4\"}" | jq -r .id); api fetch --method POST --url https://yoursubdomain.freshdesk.com/api/v2/tickets --body "{\"subject\": \"L2 Escalation: $2\", \"description\": \"Escalated from Zoho Desk ticket $1 ($3, $4).\", \"status\": 2, \"priority\": $5, \"requester_id\": \"$cid\", \"tags\": [\"escalation\", \"l2\"]}"; }
escalate zd_802 'Slow dashboard loading' 'Maria Lopez' maria@analytics.co 3
escalate zd_805 'Authentication tokens expiring' 'Lisa Chen' lisa@authtech.com 3
escalate zd_806 'Slow report generation' 'Marco Ruiz' marco@slowco.com 1
escalate zd_811 'Webhook delivery failures' 'Ravi Patel' ravi@fasttrack.io 3
escalate zd_812 'Search index corruption' 'Maria Garcia' maria.garcia@searchcorp.com 2
escalate zd_813 'Email notification delays' 'Tomoko Yamada' tomoko@emailservices.com 3
escalate zd_815 'Dashboard permissions error' 'Kenji Ito' kenji@enterprise-sla.com 2

api fetch --method POST --url https://yoursubdomain.freshdesk.com/api/v2/tickets/fd_existing_1/notes --body '{"body": "Zoho Desk ticket zd_801 (Jun Sato, jun@datacompany.com, High) reports this issue: CSV exports contain corrupted UTF-8 characters.", "private": true}'
api fetch --method POST --url https://yoursubdomain.freshdesk.com/api/v2/tickets/fd_existing_1/notes --body '{"body": "Zoho Desk ticket zd_807 (Jun Tanaka, jun.tanaka@datacompany.com, Medium) reports the same issue: Second report of the same export corruption issue.", "private": true}'

for id in zd_801 zd_802 zd_805 zd_806 zd_807 zd_811 zd_812 zd_813 zd_815; do api fetch --method POST --url "https://desk.zoho.com/api/v1/tickets/$id/comments" --body '{"content": "Escalated to L2 in Freshdesk.", "isPublic": false}'; done

api fetch --method POST --url https://slack.com/api/chat.postMessage --body '{"channel": "support-escalations", "text": "Escalated 9 Zoho Desk tickets to Freshdesk L2: Data corruption in exports (zd_801, Jun Sato, and zd_807, Jun Tanaka; noted on the existing L2 ticket), Slow dashboard loading (zd_802, Maria Lopez, priority 3), Authentication tokens expiring (zd_805, Lisa Chen, priority 3), Slow report generation (zd_806, Marco Ruiz, priority 1), Webhook delivery failures (zd_811, Ravi Patel, priority 3), Search index corruption (zd_812, Maria Garcia, priority 2), Email notification delays (zd_813, Tomoko Yamada, priority 3), Dashboard permissions error (zd_815, Kenji Ito, priority 2)."}'
