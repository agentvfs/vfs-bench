# Upstream's reference_solution, through the CLIs: read every ticket, find the
# stock-outs and their supplier, the cancelled purchases and the paid orders,
# then the suppliers' and customers' records. Nothing is updated or closed.
helpdesk list-tickets

helpdesk get-ticket --ticket-id TK-1101
helpdesk get-ticket --ticket-id TK-1102
helpdesk get-ticket --ticket-id TK-1103
helpdesk get-ticket --ticket-id TK-1104
helpdesk get-ticket --ticket-id TK-1105

inventory list-items

finance list-transactions

crm list-customers

crm get-customer --customer-id SUP-1001
crm get-customer --customer-id SUP-1002
crm get-customer --customer-id SUP-1003

crm get-customer --customer-id CUS-1101
crm get-customer --customer-id CUS-1102
crm get-customer --customer-id CUS-1103
