We have 5 new customer tickets pending. Please help me with the following analysis:
1. Review each ticket's details and the corresponding customer's CRM info (pay attention to customer tier and contract status)
2. Search the knowledge base for relevant technical docs and find applicable troubleshooting solutions
3. Based on SLA standards and customer tier, re-evaluate each ticket's priority
4. Produce a complete routing recommendation report including:
   - Recommended priority for each ticket (considering VIP acceleration and renewal-period acceleration rules)
   - Recommended knowledge base solutions
   - Tickets that need escalation and the reasons why

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: Update ticket (priority, tags, category)
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close ticket
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get full knowledge base article
- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
