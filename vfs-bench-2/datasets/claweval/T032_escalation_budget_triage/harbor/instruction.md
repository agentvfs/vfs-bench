Your inbox has several customer complaint and escalation emails. Please help process them:
1. Read all complaint emails
2. Look up each customer's tier and annual revenue in CRM
3. Match to relevant helpdesk tickets
4. For each complaint, follow these rules:
   (a) If compensation <= 5% of customer annual revenue: send notification to customer service
   (b) If compensation > 5% of customer annual revenue: save as draft only (needs management approval)
   (c) If anomaly detected (e.g., churned customer): flag as anomaly and notify legal department
5. Give me a processing summary

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save an email as a draft
- `contacts search --query <string> [--department <string>]`: Search for contacts in the directory
- `contacts get --contact-id <string>`: Get detailed contact information
- `helpdesk list-tickets [--status <string>]`: List helpdesk tickets
- `helpdesk get-ticket --ticket-id <string>`: Get detailed ticket information
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: Update ticket information
- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get detailed customer information
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: List financial transaction records
- `finance get-transaction --transaction-id <string>`: Get financial transaction details
