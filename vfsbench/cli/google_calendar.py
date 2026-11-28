import json
from pathlib import Path
from urllib.parse import quote

from aiohttp import ClientError

from .tools import json_cli

# Public command schemas from @gongrzhe/server-calendar-autoauth-mcp 1.0.2.
TOOLS = json.loads(Path(__file__).with_suffix(".json").read_bytes())
METHODS = {
    "create_event": "POST",
    "get_event": "GET",
    "update_event": "PATCH",
    "delete_event": "DELETE",
}


class Calendar:

    def __init__(self, client, endpoint):
        self.client = client
        self.events = endpoint + "/calendar/v3/calendars/primary/events"

    async def list_events(self, args):
        params = {
            **args, "singleEvents": "true",
            "maxResults": args.get("maxResults") or 10,
            "orderBy": args.get("orderBy") or "startTime"
        }
        async with self.client.get(self.events, params=params) as reply:
            reply.raise_for_status()
            rows = (await reply.json())["items"]
        return f"Found {len(rows)} events:\n" + json.dumps(
            rows, indent=2, ensure_ascii=False)

    async def call(self, name, args):
        try:
            if name == "list_events":
                return await self.list_events(args), 0
            url = self.events
            if name != "create_event":
                event = args["eventId"]
                if event in {"", ".", ".."}:
                    return "Error: Invalid event ID", 1
                url += "/" + quote(event, safe="")
            body = None
            if name in {"create_event", "update_event"}:
                body = {k: v for k, v in args.items() if k != "eventId"}
            async with self.client.request(METHODS[name], url,
                                           json=body) as reply:
                if reply.status >= 400:
                    return f"Error: {await reply.text()}", 1
                if name == "delete_event":
                    return f"Event deleted: {event}", 0
                data = await reply.json()
        except ClientError as exc:
            return f"Error: {exc}", 1
        if name == "get_event":
            return json.dumps(data, indent=2, ensure_ascii=False), 0
        if name == "create_event":
            return (f"Event created with ID: {data['id']}\n"
                    f"Title: {args['summary']}\n"
                    f"Start: {args['start']['dateTime']}\n"
                    f"End: {args['end']['dateTime']}"), 0
        unchanged = "(unchanged)"
        start = args.get("start", {}).get("dateTime") or unchanged
        end = args.get("end", {}).get("dateTime") or unchanged
        return (f"Event updated: {event}\n"
                f"New title: {args.get('summary') or unchanged}\n"
                f"New start: {start}\n"
                f"New end: {end}"), 0

    def cli(self):
        return json_cli("google-calendar",
                        self.call,
                        TOOLS,
                        TOOLS,
                        write={"create_event", "update_event", "delete_event"})
