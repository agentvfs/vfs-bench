It's the end of the month. Please help me do a comprehensive reconciliation:
1. Check the execution status of reconciliation-related automated tasks
2. Check payment and invoice system integration configurations
3. Reconcile financial transactions against CRM customer receivables
4. Reconcile procurement records against inventory changes
5. Identify all anomalies and produce a reconciliation report

## Tools

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: View financial transaction records
- `finance get-transaction --transaction-id <string>`: Get transaction details
- `crm list-customers [--status <string>] [--tier <string>]`: View customer list
- `crm get-customer --customer-id <string>`: Get customer details
- `config list-integrations [--status <string>]`: View all system integration configurations
- `config get-integration --integration-id <string>`: Get integration configuration details
- `inventory list-products [--category <string>]`: View inventory product list
- `inventory get-product --product-id <string>`: Get inventory product details
- `scheduler list-jobs [--status <string>] [--tag <string>]`: List all scheduled tasks
- `scheduler get-job --job-id <string>`: Get scheduled task details (with execution history)
- `scheduler job-history --job-id <string> [--limit <integer>]`: View scheduled task execution history
