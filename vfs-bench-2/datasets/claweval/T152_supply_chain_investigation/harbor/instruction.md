We have recently received multiple customer tickets reporting shipping delays. Please help me investigate the root cause:
1. Review the relevant tickets to understand customer complaints
2. Check the inventory system to identify out-of-stock products
3. Review procurement records and financial transactions
4. Check supplier status in the CRM system
5. Produce a supply chain anomaly analysis report that reconstructs the complete problem chain

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: Update ticket (priority, tags, category)
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close a ticket
- `inventory list-items [--category <string>]`: List inventory items
- `inventory get-item --product-id <string>`: Get inventory item details
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: List financial transactions
- `finance get-transaction --transaction-id <string>`: Get transaction details
- `crm list-customers [--status <string>] [--tier <string>]`: List customers and suppliers
- `crm get-customer --customer-id <string>`: Get customer or supplier details
