Recently several users have filed tickets reporting system issues, and our scheduled jobs also have some failure records.
Please help me:
1. Review all failed scheduled jobs and their error messages
2. Review all currently unresolved tickets
3. Analyze which tickets are correlated with scheduled job failures
4. Produce a correlation analysis report showing which tickets correspond to each failed job, the scope of impact, and recommended handling priority

## Tools

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--tag <string>]`: List scheduled jobs
- `scheduler get-job --job-id <string>`: Get scheduled job details (including execution history)
- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: Update ticket (priority, tags, category)
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close ticket
