# Upstream's reference_solution, through the CLIs: the three failing jobs and
# their dependencies, the supplier API integrations, the stale products, the
# tickets, and the KB's migration, dependency and resync articles. No ticket
# is updated or closed.
scheduler list-jobs

scheduler get-job --job-id JOB-1501
scheduler get-job --job-id JOB-1502
scheduler get-job --job-id JOB-1503

config list-integrations

config get-integration --integration-id INT-1501
config get-integration --integration-id INT-1502

inventory list-products

helpdesk list-tickets

helpdesk get-ticket --ticket-id TK-1501
helpdesk get-ticket --ticket-id TK-1502
helpdesk get-ticket --ticket-id TK-1503
helpdesk get-ticket --ticket-id TK-1504

kb search --query '供应商 API 迁移'

kb get-article --article-id KB-1501
kb get-article --article-id KB-1502

kb search --query '库存 同步 修复'

kb get-article --article-id KB-1503
