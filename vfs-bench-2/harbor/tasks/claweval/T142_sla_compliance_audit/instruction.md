Please help me perform an SLA compliance audit:
1. Review the SLA response time rules in the system configuration
2. Check the actual response times of recent tickets and compare them against SLA standards to determine compliance
3. Check the running status of SLA-related automation tasks and identify any anomalies
4. Output an SLA compliance analysis report including: compliant/non-compliant ticket details, automation failure impact analysis, and improvement recommendations

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...]`: Update ticket
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close ticket
- `scheduler list-jobs [--status <string>] [--tag <string>]`: List scheduled jobs
- `scheduler get-job --job-id <string>`: Get scheduled job details
- `config list-integrations [--type <string>] [--status <string>]`: List system integration configurations
- `config get-integration --integration-id <string>`: Get integration configuration details
