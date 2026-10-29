Current date: 2026-03-26

Please generate a weekly meeting action item tracking report for last week:
1. Review last week's calendar meetings
2. Find meetings that have minutes and review their action items
3. Look up the completion status of each action item in the to-do list
4. Identify missing action items (present in meeting minutes but absent from to-dos)
5. Output a weekly progress report: grouped by meeting, with status and completion rate for each item

## Tools

The calendar is mounted at /calendar. The `gws` CLI reads, creates and deletes events (`gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `notes list [--tag <string>]`: List meeting minutes
- `notes get --note-id <string>`: Get meeting minutes details
- `todo list-tasks [--status <string>]`: List to-do items
- `todo get-task --task-id <string>`: Get to-do item details
