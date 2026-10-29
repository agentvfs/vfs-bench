Please check the contract expiry status of all active customers and identify those expiring within 60 days.
For each customer whose contract is about to expire:
1. Review customer details in the CRM (tier, revenue, assigned sales representative)
2. Look up the contact information for the assigned sales representative
3. Check the inbox for any recent communications regarding that customer
4. Based on customer tier (VIP/standard) and urgency, draft a renewal reminder email for VIP customers
Finally, produce a comprehensive renewal warning report.

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `contacts search --query <string> [--department <string>]`: Search internal directory
- `contacts get --contact-id <string>`: Get contact details
- `gmail save-draft --to <string> --subject <string> --body <string>`: Save email draft
