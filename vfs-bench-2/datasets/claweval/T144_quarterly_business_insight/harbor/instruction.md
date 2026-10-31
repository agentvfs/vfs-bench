Q1 is about to end. Please help me create a quarterly business analysis report:
1. Pull Q1 revenue data for each customer from the finance system and analyze revenue trends (growing/flat/declining)
2. Review customer information in the CRM (tier, industry, contract status)
3. Browse industry RSS feeds to understand market trends in each customer's industry
4. Comprehensive analysis: which customers are growing (why), which are declining (what risks), reasons for churned customers
5. Output Q2 forecast and recommendations

## Tools

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: View transaction records
- `finance get-transaction --transaction-id <string>`: Get transaction details
- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `rss list-feeds`: List RSS feed sources
- `rss get-feed --feed-id <string>`: Get RSS feed article list
- `rss get-article --article-id <string>`: Get article details
