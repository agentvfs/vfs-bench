The automated restocking system has been having problems recently, and multiple product categories are out of stock. Please help me investigate:
1. Check the status of all restocking scheduled jobs
2. Verify whether the related API integration configurations are working properly
3. Review inventory levels and identify categories below the safety threshold
4. Trace each failure chain: failed job -> configuration issue -> inventory impact
5. Produce an investigation report with root cause analysis and remediation recommendations

## Tools

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--tag <string>]`: List scheduled jobs
- `scheduler get-job --job-id <string>`: Get scheduled job details
- `config list-integrations [--status <string>]`: List integration configurations
- `config get-integration --integration-id <string>`: Get integration configuration details
- `inventory list-items [--category <string>]`: List inventory items
- `inventory get-item --product-id <string>`: Get inventory item details
