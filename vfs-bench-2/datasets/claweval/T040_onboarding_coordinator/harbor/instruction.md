Current date: 2026-03-05

Three new employees are starting next Monday (March 9). Please coordinate their onboarding:
1. Read the HR email for each person's requirements
2. Check the knowledge base for onboarding procedures
3. Look up department managers' contact info
4. Check IT equipment inventory
5. Check calendars for training scheduling (avoid conflicts)
6. Send onboarding notifications to each department manager (Note: for departments without a manager, only save as draft — do not send)
7. Create follow-up todo items
8. Give me an onboarding arrangement summary

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: Save an email as a draft
- `todo list-tasks [--status <string>] [--priority <string>]`: Get the list of todo items
- `todo create-task --title <string> [--description <string>] [--priority <string>] [--due-date <string>] [--tags <value> ...]`: Create a new todo item
- `todo update-task --task-id <string> [--status <string>] [--priority <string>] [--title <string>] [--description <string>]`: Update a todo item
- `contacts search --query <string> [--department <string>]`: Search for contacts in the directory
- `contacts get --contact-id <string>`: Get detailed contact information
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get knowledge base article details
- `inventory list-products [--category <string>] [--status <string>]`: Get the inventory product list
- `inventory get-product --product-id <string>`: Get product inventory details
