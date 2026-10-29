Current date: 2026-03-26

There is an urgent ticket from a VIP customer that requires onsite support. Please help me:
1. Review the urgent ticket details and customer CRM information
2. Check technicians' skills and today's schedule
3. Select the most suitable engineer for dispatch
4. Draft notification emails (to the engineer and the account manager)

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save email draft
- `contacts search --query <string> [--department <string>]`: Search internal directory
- `contacts get --contact-id <string>`: Get contact details
- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>] [--assigned-to <string>]`: Update ticket (priority, tags, category)
