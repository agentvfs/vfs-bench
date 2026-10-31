There are currently 6 unassigned tickets. Please help me with assignment suggestions:
1. Review each ticket's details to understand the issue type and submitting department
2. Look up the person in charge for each department in the contacts directory
3. Match the most suitable handler based on issue type
4. Be sure to distinguish between IT issues and non-IT issues
5. Output an assignment suggestion table (ticket -> suggested handler -> assignment reason)

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `contacts search --query <string> [--department <string>]`: Search internal contacts directory
- `contacts get --contact-id <string>`: Get contact details
