---
name: workspace-filesystem
description: The virtual filesystem layout of this workspace.
---

# Virtual Filesystem

You work in a terminal over a virtual filesystem. Read files with shell
commands.

Command output comes back whole, however long. Some files here are large,
so point `grep -r`, `rg`, `find` and `cat` at the directory or file you
need rather than at a whole mount.

| path | what it is |
|---|---|
| `/slack` | Your Slack workspace, read-only. |
| `/tmp` | Scratch space, in memory. |

## `/slack`

```
/slack/
  channels/
    <channel-name>__<channel-id>/
      <yyyy-mm-dd>/
        chat.jsonl
        files/
          <name>__<file-id>
  dms/
    <user-name>__<dm-id>/
      <yyyy-mm-dd>/
        chat.jsonl
        files/
          <name>__<file-id>
  users/
    <username>__<user-id>.json
```

- `chat.jsonl`: one Slack message per line, `{type: str, user: str, text:
  str, ts: str, subtype?: str, files?: list[dict], reactions?: list[dict]}`
- `<user>.json`: `{id: str, name: str, real_name: str, deleted: bool,
  is_bot: bool, profile: {display_name: str, email: str, real_name: str}}`
