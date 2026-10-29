Help me organize the system's scheduled tasks. Check the status of all scheduled jobs, find any failed or abnormal tasks, check the knowledge base for relevant troubleshooting guides, then:
1. Fix what can be fixed (re-enable mistakenly disabled tasks, adjust schedules to avoid conflicts)
2. For issues requiring manual intervention, send email notifications to the ops team
3. Give me a scheduled task health report

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--enabled <boolean>] [--tag <string>]`: List all scheduled jobs
- `scheduler get-job --job-id <string>`: Get scheduled job details
- `scheduler create-job --name <string> --cron-expression <string> --action <string> [--enabled <boolean>] [--tags <value> ...]`: Create a new scheduled job
- `scheduler update-job --job-id <string> [--enabled <boolean>] [--cron-expression <string>] [--name <string>] [--action <string>] [--tags <value> ...]`: Update scheduled job configuration
- `scheduler delete-job --job-id <string>`: Delete a scheduled job
- `scheduler job-history --job-id <string> [--limit <integer>]`: View scheduled job execution history
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get knowledge base article details
- `gmail save-draft --to <string> --subject <string> --body <string>`: Save email as draft
