There are several customer complaint emails in the inbox that need your help investigating and providing recommendations for each.
For each complaint email:
1. Read the complaint content and understand the customer's concern
2. Look up the customer's information in CRM (tier, contract amount, etc.)
3. Check the relevant transaction records in the finance system to verify whether the customer's claims are accurate
4. Find the contact details of the internal person responsible
5. Write an investigation conclusion and handling recommendation for each complaint case, and draft a reply email for the most urgent case

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save email draft
- `contacts search --query <string> [--department <string>]`: Search internal directory
- `contacts get --contact-id <string>`: Get contact details
- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: View transaction records
- `finance get-transaction --transaction-id <string>`: Get transaction details
