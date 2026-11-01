Please help me conduct a monthly system health check:
1. Check the status of all API integration configurations
2. Check the execution status of scheduled jobs
3. Review currently unresolved tickets
4. Search the knowledge base for known solutions
5. Produce a system health report, noting fault chains and repair recommendations

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...]`: Update a ticket
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close a ticket
- `scheduler list-jobs [--status <string>] [--tag <string>]`: List scheduled jobs
- `scheduler get-job --job-id <string>`: Get scheduled job details
- `config list-integrations [--type <string>] [--status <string>]`: List system integration configurations
- `config get-integration --integration-id <string>`: Get integration configuration details
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get full knowledge base article
