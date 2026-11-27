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
| `/notion` | Your Notion workspace, read-only. |
| `/slack` | Your Slack workspace, read-only. |
| `/tmp` | Scratch space, in memory. |

## `/notion`

```
/notion/
  pages/
    <page-title>__<page-id>/
      page.json
      <child-page-title>__<child-id>/
        page.json
  databases/
    <database-title>__<database-id>/
      database.json
      <data-source-title>__<data-source-id>/
        data_source.json
        rows.jsonl
```

A title in a path is sanitized: spaces and characters unsafe in a shell
become `_`. `ls` the parent directory for the exact name, or take a row's
`path` from `rows.jsonl`.

- `database.json`: `{database_id: str, title: str, url: str | null,
  created_time: str | null, last_edited_time: str | null, parent: dict,
  archived: bool, is_inline: bool, data_sources: list[{id: str, name: str}]}`
- `data_source.json`: `{data_source_id: str, database_id: str, title: str,
  created_time: str | null, last_edited_time: str | null, database_parent:
  dict, archived: bool, properties: {<column>: {id: str, name: str, type:
  str, <type>: dict}}}`
- `rows.jsonl`: one row per line, `{page_id: str, title: str, path: str,
  url: str, created_time: str, last_edited_time: str, parent_type: str,
  parent_id: str, archived: bool, created_by: str, last_edited_by: str,
  properties: {<column>: {id: str, type: str, <type>: <value>}}}`. Row
  directories are not listed; a row's `page.json` is at its `path` below the
  data source directory. A table's `rows.jsonl` can run to several
  megabytes.
- `page.json`: a row's fields less `path`, plus `markdown: str`, the body,
  and `blocks: list[dict]`

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
