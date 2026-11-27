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
| `/data` | Your files. |
| `/calendar` | Your Google Calendar, read-only. |
| `/tmp` | Scratch space, in memory. |

## `/calendar`

```
/calendar/
  primary/
    calendar.json
    <yyyy-mm-dd>/
      <event-id>__<HHMM-HHMM>_<Title>.gcal.json
```

- `calendar.json`: `{id: str, summary: str, accessRole: str, primary: bool,
  calendarTimeZone: str, bucketTimeZone: str}`
- `<event>.gcal.json`: the Calendar API's event, `{kind: str, id: str,
  status: str, summary: str, description?: str, location?: str, start:
  {dateTime: str, timeZone: str}, end: {dateTime: str, timeZone: str},
  created: str, updated: str, iCalUID: str, htmlLink: str}`

Days are cut in `bucketTimeZone`. Listing `/calendar/primary`, with `ls` or
`find`, shows every day with an event up to 90 days after today; read a later
day by its date, as in `ls /calendar/primary/2027-03-*`.
