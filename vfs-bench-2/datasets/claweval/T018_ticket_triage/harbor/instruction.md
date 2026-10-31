Review open support tickets, categorize, set priorities, tag related ones. Do not close any tickets.

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: Get the list of tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: Update ticket information
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close a ticket
