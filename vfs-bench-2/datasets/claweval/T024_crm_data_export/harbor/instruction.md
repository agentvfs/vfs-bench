Export a VIP customer report from CRM. System's been flaky — retry on errors.

## Tools

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: Get the CRM customer list, filterable by status, tier, or industry
- `crm get-customer --customer-id <string>`: Get full details for a single customer
- `crm export-report --title <string> --customer-ids <value> ... --summary <string>`: Export a customer summary report
