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
| `/airtable` | Your Airtable bases, read-only. |
| `/tmp` | Scratch space, in memory. |

## `/airtable`

```
/airtable/
  bases/
    <base-name>__<base-id>/
      base.json
      <table-name>__<table-id>/
        table.json
        records.jsonl
        views/
          <view-name>__<view-id>.jsonl
```

A base, table or view name in a path is sanitized: spaces and characters
unsafe in a shell become `_`. `ls` a directory for the exact name rather
than building the path; the id after the last `__` is exact.

- `base.json`: `{base_id: str, base_name: str, permission_level: str,
  tables: list[{table_id: str, table_name: str, primary_field_id: str}]}`
- `table.json`: `{table_id: str, table_name: str, base_id: str, description:
  str | null, primary_field_id: str, fields: list[{field_id: str,
  field_name: str, type: str, description: str | null, options: dict |
  null}], views: list[{view_id: str, view_name: str, type: str}]}`
- `records.jsonl`: one record per line, `{record_id: str, created_time: str,
  fields: {<field-name>: <value>}}`; an empty cell is absent
- `<view>.jsonl`: the records the view shows, in its order, as
  `records.jsonl` writes them
