I need to compile a competitive intelligence report:
1. Check emails to understand the report requirements and frontline sales feedback
2. Collect latest updates on Competitor A and Competitor B from RSS feeds
3. Search the knowledge base for our existing competitor analyses
4. Synthesize information and output a competitive intelligence report:
   - Competitor A analysis (new version + AI capability threat)
   - Competitor B analysis (funding + overseas expansion strategy)
   - Impact on our company and recommended responses
5. Prepare an email draft (do NOT send it directly)

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `rss list-articles [--feed-name <string>] [--category <string>] [--max-results <integer>]`: Get RSS article list
- `rss get-article --article-id <string>`: Get article details
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: Search knowledge base articles
- `kb get-article --article-id <string>`: Get full knowledge base article
- `gmail save-draft --to <string> --subject <string> --body <string>`: Save email draft
