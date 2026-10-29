Please help me check the customer contact status in the CRM:
1. Find active customers who have not been contacted for over 30 days
2. Review email records to understand the last communication content
3. Draft follow-up emails with different styles based on customer tier (VIP/standard)
   - VIP customers: formal, attentive, mention the partnership
   - Standard customers: friendly, concise, inquire about needs
4. Make sure to exclude churned customers
5. Output a list of customers needing follow-up and corresponding email drafts

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>]`: List customers
- `crm get-customer --customer-id <string>`: Get customer details
- `gmail save-draft --to <string> --subject <string> --body <string>`: Save email draft
