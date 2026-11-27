---
name: workspace-filesystem
description: The virtual filesystem layout of this workspace.
---

# Virtual Filesystem

You work in a terminal over a virtual filesystem. Read files with shell
commands; service operations are listed in SKILL.md.

| Path | Description |
|---|---|
| `/workspace` | Agent workspace; current directory and home (`~`). |
| `/tmp` | Temporary files. |
| `/dev` | Device files: `null` and `zero` (mounted automatically). |
| `/mail` | Mailbox, read-only. Directories are IMAP folders; change them with the `emails` CLI. |
| `/notion` | Notion workspace, read-only; change it with the `notion` CLI. |

## `/mail` layout

```
/mail/<folder>/<yyyy-mm-dd>/<subject>__<uid>.email.json
/mail/<folder>/<yyyy-mm-dd>/<subject>__<uid>/<attachment>
```

Folders include `INBOX`, `Sent`, `Drafts`. Read message JSON and attachments
with shell commands. Subjects are sanitized; list directories to find paths.

## `/notion` layout

```
/notion/pages/<Title>__<page-id>/page.json
/notion/pages/<Title>__<page-id>/<Child-Title>__<child-id>/page.json
/notion/databases/<Title>__<db-id>/database.json
/notion/databases/<Title>__<db-id>/<Name>__<ds-id>/data_source.json
/notion/databases/<Title>__<db-id>/<Name>__<ds-id>/rows.jsonl
```

A database holds one or more data sources; the column schema and the rows
live under the data source. `data_source.json` holds the typed column
schema, and `rows.jsonl` holds the rows, one JSON object per line: a row's
`page.json` without its body, plus `path`, where that `page.json` sits
below the data source directory. Row directories are not listed; open one
by its `path`. `page.json` holds a page's metadata, its body as
`markdown`, its raw `blocks`, and, for a database row, its cell values
under `properties`. Use `notion` for changes.
