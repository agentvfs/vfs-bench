# Upstream's reference_solution, through the CLIs and read-only: every ticket
# of the incident (the list shows one status at a time), the integrations'
# state, the incident emails, the December incident in the KB, the release
# review notes and the CRM sync and monitoring jobs' history.
helpdesk list-tickets --status open
helpdesk list-tickets --status investigating
helpdesk list-tickets --status resolved
helpdesk list-tickets --status done

helpdesk get-ticket --ticket-id TK-1901
helpdesk get-ticket --ticket-id TK-1902
helpdesk get-ticket --ticket-id TK-1903
helpdesk get-ticket --ticket-id TK-1904
helpdesk get-ticket --ticket-id TK-1905
helpdesk get-ticket --ticket-id TK-1906
helpdesk get-ticket --ticket-id TK-1907
helpdesk get-ticket --ticket-id TK-1908
helpdesk get-ticket --ticket-id TK-1909
helpdesk get-ticket --ticket-id TK-1910
helpdesk get-ticket --ticket-id TK-1911
helpdesk get-ticket --ticket-id TK-1912

config list-integrations

config get-integration --integration-id INT-201
config get-integration --integration-id INT-202
config get-integration --integration-id INT-203
config get-integration --integration-id INT-204

gmail list-messages

gmail get-message --message-id msg_1901
gmail get-message --message-id msg_1902
gmail get-message --message-id msg_1903

kb search --query 事故

kb search --query 连接池

kb get-article --article-id KB-603
kb get-article --article-id KB-602

notes list

notes get --note-id NOTE-601
notes get --note-id NOTE-602

scheduler list-jobs

scheduler get-job --job-id JOB-301
scheduler get-job --job-id JOB-303
