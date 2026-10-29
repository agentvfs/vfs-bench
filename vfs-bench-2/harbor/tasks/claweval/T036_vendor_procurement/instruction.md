We need to procure a batch of servers. Help me do a vendor evaluation. Please:
1. Check the inventory system for current server stock and needs
2. Check RSS news for vendor market developments
3. Look up vendor partnership history in the CRM
4. Review procurement policy and evaluation criteria in the knowledge base
5. Check the finance system for budget and historical procurement records
6. Synthesize all information into a vendor evaluation report with procurement recommendations
Note: Do not place any purchase orders or contact vendors directly — only evaluate and analyze.

## Tools

Each tool is a shell command; `<command> --help` says more.

- `inventory list-products [--category <string>]`: Get the product inventory list
- `inventory get-product --product-id <string>`: Get detailed inventory information for a single product
- `rss list-articles [--source <string>] [--category <string>] [--max-results <integer>]`: Get the list of articles
- `rss get-article --article-id <string>`: Get the full content of an article
- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: Get the CRM customer list, filterable by status, tier, or industry
- `crm get-customer --customer-id <string>`: Get full details for a single customer
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get knowledge base article details
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: Get the list of expense transaction records
- `finance get-transaction --transaction-id <string>`: Get details for a single transaction
- `finance report-submit --title <string> --content <string> [--total-amount <number>] [--report-type <string>]`: Submit a financial report
