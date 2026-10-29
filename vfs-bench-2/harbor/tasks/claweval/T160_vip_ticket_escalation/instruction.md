A VIP customer has submitted a critical-level ticket. Please help me handle the escalation process:
1. Review ticket details and customer CRM information
2. Search the knowledge base for solutions
3. Find the appropriate technical lead
4. Draft escalation notification emails (internal notification + customer reply draft)

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--assigned-to <string>]`: Update ticket (priority, tags, assignment)
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close ticket
- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get full knowledge base article
- `contacts search --query <string> [--department <string>]`: Search internal directory
- `contacts get --contact-id <string>`: Get contact details
- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save email draft
