My boss asked me to compile this week's AI/LLM industry briefing. Please help:
1. Filter articles related to AI/LLMs from the RSS feeds this week
2. Categorize by topic (model releases / real-world applications / AI chips)
3. Compile into a structured briefing draft
4. Prepare it as an email draft; do not send it directly

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `rss list-articles [--feed-name <string>] [--category <string>] [--max-results <integer>]`: Get RSS article list
- `rss get-article --article-id <string>`: Get article details
- `gmail save-draft --to <string> --subject <string> --body <string>`: Save email draft
