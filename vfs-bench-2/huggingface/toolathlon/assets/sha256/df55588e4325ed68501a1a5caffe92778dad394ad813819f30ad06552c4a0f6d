---
name: workspace-filesystem
description: The virtual filesystem layout of this workspace.
---

# Virtual Filesystem

You work in a terminal over a virtual filesystem. Google Drive is mounted
at `/gd`.
Read it with shell commands; use `google-sheet` for spreadsheet operations
listed in SKILL.md.

| path | what it is |
|---|---|
| `/gd` | Google Drive, read-only. Directories are Drive folders; change spreadsheets with the `google-sheet` CLI. |
| `/workspace` | Agent workspace; current directory and home (`~`). |
| `/tmp` | Scratch space, in memory. |

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
