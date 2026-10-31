Clean up my to-do list — merge duplicates (use mark-as-completed to merge, do not delete any items) and flag overdue items.

## Tools

Each tool is a shell command; `<command> --help` says more.

- `todo list-tasks [--status <string>]`: Get all to-do items
- `todo update-task --task-id <string> [--title <string>] [--priority <string>] [--status <string>] [--tags <value> ...]`: Update a to-do item
- `todo create-task --title <string> [--description <string>] [--priority <string>] [--due-date <string>]`: Create a new to-do item
- `todo delete-task --task-id <string>`: Permanently delete a to-do item
