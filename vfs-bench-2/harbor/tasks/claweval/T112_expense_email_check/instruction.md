There are several expense reimbursement request emails in the inbox. Please help me:
1. Review all reimbursement-related emails and extract the amount and invoice number for each claim
2. Look up the corresponding transaction records in the finance system
3. Cross-verify each reimbursement: whether amounts match and whether the transaction status is complete
4. Produce a verification report listing: items that match correctly, items with amount discrepancies, and items with status anomalies

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: List transaction records
- `finance get-transaction --transaction-id <string>`: Get transaction details
