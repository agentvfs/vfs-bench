# Upstream's reference_solution, through the CLIs: the failing reconciliation
# and invoice jobs, the integrations behind them, then every transaction,
# customer (the list leaves out what each owes) and product, reconciled in
# the reply.
scheduler list-jobs

scheduler get-job --job-id JOB-1301

scheduler get-job --job-id JOB-1302

config list-integrations

config get-integration --integration-id INT-1301
config get-integration --integration-id INT-1302
config get-integration --integration-id INT-1303
config get-integration --integration-id INT-1304

finance list-transactions

crm list-customers

crm get-customer --customer-id CUS-1301
crm get-customer --customer-id CUS-1302
crm get-customer --customer-id CUS-1303
crm get-customer --customer-id CUS-1304
crm get-customer --customer-id CUS-1305
crm get-customer --customer-id CUS-1306

inventory list-products
