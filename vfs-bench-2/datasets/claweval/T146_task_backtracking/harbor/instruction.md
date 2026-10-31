There are several follow-up emails in the inbox. Please help me:
1. Read each follow-up email and understand what is being requested
2. Find the corresponding tasks in the to-do list to understand current progress
3. Search meeting notes for related discussion records to add context
4. For each follow-up item, summarize: current status, blocking reasons (if any), and estimated completion time
5. Draft a reply for each follow-up email explaining the progress

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save an email draft
- `todo list-tasks [--status <string>]`: List to-do items
- `todo get-task --task-id <string>`: Get to-do item details
- `notes list [--days-back <integer>]`: List meeting notes
- `notes get --note-id <string>`: Get meeting note details
