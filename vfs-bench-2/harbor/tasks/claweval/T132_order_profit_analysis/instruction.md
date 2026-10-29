Please help me analyze the profit situation for each customer's orders:
1. Get each customer's recent orders and product mix from the CRM
2. Look up the cost price for each product from the inventory system
3. Verify payment status from the finance system
4. Calculate the profit margin for each customer's order = (selling price - cost) / selling price
5. Flag any payment anomalies (outstanding balance, refunds, etc.)
6. Output a customer profit analysis report

## Tools

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `inventory list-items [--category <string>]`: List inventory/products
- `inventory get-item --product-id <string>`: Get product details
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: List transactions
- `finance get-transaction --transaction-id <string>`: Get transaction details
