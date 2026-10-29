Current date: 2026-03-25

There are several business trip invitation emails in my inbox. Please help me plan:
1. Review all business trip related emails
2. Check the calendar for conflicts on the corresponding dates
3. Look up contact information for local colleagues at each trip destination
4. Provide a comprehensive trip recommendation after analysis:
   - Which itineraries conflict and require trade-offs
   - Recommended trip arrangement
   - Contact list for each destination

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `contacts search --query <string> [--department <string>]`: Search internal contacts directory
- `contacts get --contact-id <string>`: Get contact details
