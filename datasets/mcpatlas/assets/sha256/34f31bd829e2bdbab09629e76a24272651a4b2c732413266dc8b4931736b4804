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
| `/data/repos` | Your git repositories. |
| `/mongodb` | Your MongoDB databases, read-only; change them with the `mongodb` CLI. |
| `/tmp` | Scratch space, in memory. |

## `/mongodb`

```
/mongodb/
  <database>/
    database.json
    collections/
      <collection>/
        schema.json
        documents.jsonl
    views/
      <view>/
        schema.json
        documents.jsonl
```

- `database.json`: `{database: str, collections: list[{name: str}],
  views: list[{name: str}]}`
- `schema.json`: `{database: str, name: str, kind: str, validator: dict |
  null, fields: list[{path: str, presence: number, types: dict}],
  primary_key: str, indexes: list[{name: str, keys: dict, type: str}],
  sampled: int}`, read from a sample of `sampled` documents
- `documents.jsonl`: one document per line, in MongoDB Extended JSON: a date
  reads as `{"$date": "..."}`
