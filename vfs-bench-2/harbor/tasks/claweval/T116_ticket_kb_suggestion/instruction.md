There are currently 5 unresolved customer tickets. Please help me:
1. Review the details of each ticket
2. Search the knowledge base for relevant articles and match the most relevant solution to each ticket
3. Check the last updated date of knowledge base articles and flag any that are outdated
4. For tickets with no matching solution in the knowledge base, mark them as requiring manual handling
5. Produce a summary table of suggested replies

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: List tickets
- `helpdesk get-ticket --ticket-id <string>`: Get ticket details
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: Close ticket
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get full knowledge base article
