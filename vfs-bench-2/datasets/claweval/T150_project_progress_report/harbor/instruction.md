Current date: 2026-03-24

Please help me generate progress reports for 3 parallel projects (Alpha/Beta/Gamma):
1. Review the relevant meetings for each project
2. Read the action items from meeting notes
3. Compare the completion status of to-do items
4. Look up the contact information of project leads
5. Produce a progress report for each project, marking risk items

## Tools

The calendar is mounted at /calendar. The `gws` CLI reads, creates and deletes events (`gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `notes list [--tag <string>]`: List meeting notes
- `notes get --note-id <string>`: Get meeting note details
- `todo list-tasks [--status <string>]`: View to-do list
- `todo get-task --task-id <string>`: Get to-do item details
- `contacts search --query <string> [--department <string>]`: Search internal directory
- `contacts get --contact-id <string>`: Get contact details
