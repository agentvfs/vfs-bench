Q1 has ended. Please help me prepare a quarterly review for our 6 key customers:
1. Review each customer's Q1 financial data
2. Check customer information and satisfaction scores in the CRM
3. Review email communication records
4. Browse industry news to understand trends in each customer's sector
5. Look up the contact information of the assigned account managers
6. Produce a customer review report, flagging risks and growth opportunities

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: List transaction records
- `finance get-transaction --transaction-id <string>`: Get transaction details
- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `rss list-feeds`: List RSS feed sources
- `rss get-feed --feed-id <string>`: Get articles from an RSS feed
- `rss get-article --article-id <string>`: Get article details
- `contacts search --query <string> [--department <string>]`: Search internal directory
- `contacts get --contact-id <string>`: Get contact details
