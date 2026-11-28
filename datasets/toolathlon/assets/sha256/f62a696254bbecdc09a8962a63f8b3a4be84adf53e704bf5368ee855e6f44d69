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

## `/mail` layout

```
/mail/<folder>/<yyyy-mm-dd>/<subject>__<uid>.email.json
/mail/<folder>/<yyyy-mm-dd>/<subject>__<uid>/<attachment>
```

Folders include `INBOX`, `Sent`, `Drafts`. Read message JSON and attachments
with shell commands. Subjects are sanitized; list directories to find paths.
