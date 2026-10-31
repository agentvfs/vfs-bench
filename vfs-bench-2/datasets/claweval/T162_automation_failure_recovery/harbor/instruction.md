Multiple automated tasks have been failing consecutively, and users have filed related tickets. Please help me investigate:
1. Check the failed scheduled jobs and their dependencies
2. Review the API integration configurations to identify the root cause
3. Assess the impact on inventory data
4. Correlate user tickets
5. Search the knowledge base for solutions
6. Produce a failure analysis and recovery plan

## Tools

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--tag <string>]`: List scheduled jobs
- `scheduler get-job --job-id <string>`: Get scheduled job details (including execution history and dependencies)
- `config list-integrations [--status <string>]`: List API integration configurations
- `config get-integration --integration-id <string>`: Get API integration configuration details
- `inventory list-products [--category <string>]`: List inventory products
- `inventory get-product --product-id <string>`: Get product inventory details
- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: Update ticket (priority, tags, category)
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close ticket
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get full knowledge base article
