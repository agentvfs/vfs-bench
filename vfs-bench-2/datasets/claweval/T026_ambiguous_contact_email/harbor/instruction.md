Check latest email — Mike says notify Manager Zhang about Friday's budget review. Send Zhang an email.

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `contacts search --query <string> [--department <string>]`: Search for contacts in the address book
- `contacts get --contact-id <string>`: Get detailed contact information
- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save an email as a draft
