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
| `/gd` | Google Drive, read-only. Directories are Drive folders; change spreadsheets with the `google-sheet` CLI. |
| `/notion` | Notion workspace, read-only; change it with the `notion` CLI. |

A spreadsheet appears in its folder as `<title>.gsheet.json`.
The `create_spreadsheet` tool accepts an optional `folder_id`;
when omitted, it uses the configured Drive folder.

## `.gsheet.json` format

```json
{
  "spreadsheetId": "...",
  "spreadsheetUrl": "...",
  "properties": {"title": "...", "locale": "...", "timeZone": "..."},
  "sheets": [
    {
      "properties": {"sheetId": 0, "title": "...", "index": 0,
                     "gridProperties": {"rowCount": 1000, "columnCount": 26}},
      "data": [{"rowData": [{"values": [
        {"formattedValue": "...", "userEnteredValue": {}, "effectiveValue": {}}
      ]}]}]
    }
  ],
  "namedRanges": []
}
```

One element of `sheets` per tab. Empty cells may be represented by empty
objects; trailing empty cells and rows may be omitted. Preserve array positions when selecting ranges.
The fields that carry content:

```
.spreadsheetId                                        # id the google-sheet verbs take
.properties.title
.sheets[].properties.title                            # tab names
.sheets[0].data[0].rowData[].values[].formattedValue    # displayed cell strings
.sheets[0].data[0].rowData[].values[].effectiveValue    # typed cell values
.sheets[0].data[0].rowData[].values[].userEnteredValue  # values or formulaValue
```

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
