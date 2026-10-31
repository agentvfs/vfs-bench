Please help me perform a cross-verification of inventory and procurement costs:
1. Review the quantity and unit cost of all current inventory items
2. Review the corresponding procurement transaction records in the finance system
3. Compare: whether the unit price in inventory records matches the actual purchase price
4. Identify categories with cost anomalies (unit price discrepancies, different prices across batches, etc.)
5. Output a cost analysis report

## Tools

Each tool is a shell command; `<command> --help` says more.

- `inventory list-items [--category <string>]`: View inventory list
- `inventory get-item --product-id <string>`: Get inventory item details
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: View transaction records
- `finance get-transaction --transaction-id <string>`: Get transaction details
