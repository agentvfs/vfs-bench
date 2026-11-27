import json
import urllib.request
from urllib.parse import quote

SITE = "https://amazing-wave-b38.notion.site"
SPACE = "9d4d10a4-8436-817d-abe4-00036122053e"

# Notion's own record types on the left, the REST API's block types on the
# right. Only types some task's template actually uses are here: an unmapped
# type raises rather than degrading to a paragraph, because a heading that
# silently became body text would move an evaluator's section boundary.
BLOCK_TYPES = {
    "text": "paragraph",
    "header": "heading_1",
    "sub_header": "heading_2",
    "sub_sub_header": "heading_3",
    "bulleted_list": "bulleted_list_item",
    "numbered_list": "numbered_list_item",
    "quote": "quote",
    "divider": "divider",
    "bookmark": "bookmark",
}

# Blocks with no REST equivalent that carry nothing a task needs.
# `external_object_instance` is a Notion-side embed of another service.
DROPPED = ("external_object_instance", )


def post(path: str, body: dict) -> dict:
    """POST JSON to notion.site's unauthenticated record API.

    Args:
        path (str): API path, e.g. "loadPageChunk".
        body (dict): request body.

    Returns:
        dict: decoded response.
    """
    # notion.site answers 403 to urllib's default User-Agent.
    req = urllib.request.Request(f"{SITE}/api/v3/{path}",
                                 data=json.dumps(body).encode(),
                                 headers={
                                     "Content-Type": "application/json",
                                     "User-Agent": "vfs-bench/1.0",
                                 },
                                 method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def unwrap(record: dict) -> dict:
    """Pull the value out of a recordMap entry.

    Args:
        record (dict): one recordMap entry.

    Returns:
        dict: the record's value object.
    """
    value = record.get("value", {})
    return value.get("value", value)


def plain(prop: list | None) -> str:
    """Flatten one of Notion's `[[text, ...], ...]` property values.

    Args:
        prop (list | None): a raw record-API property value.

    Returns:
        str: the concatenated text, or "" when the property is unset.
    """
    if not prop:
        return ""
    return "".join(seg[0] for seg in prop if isinstance(seg, list))


def rich_text(text: str) -> list:
    """Build the API's rich-text array for a plain string.

    Args:
        text (str): the text.

    Returns:
        list: a one-element rich-text array, or [] for the empty string.
    """
    if text == "":
        return []
    return [{"type": "text", "plain_text": text, "text": {"content": text}}]


def schema_of(record_map: dict, collection_id: str) -> dict:
    """Read one collection's column schema.

    Args:
        record_map (dict): a response's recordMap.
        collection_id (str): the collection id.

    Returns:
        dict: Notion's raw schema, keyed by property id.
    """
    return unwrap(record_map["collection"][collection_id]).get("schema", {})


def db_properties(schema: dict) -> dict:
    """Convert a record-API schema into the REST API's `properties` object.

    Args:
        schema (dict): raw schema, keyed by property id.

    Returns:
        dict: REST-shaped properties, keyed by column name.
    """
    # Notion's record API spells a text column "text" and the REST API spells
    # it "rich_text"; every other type it uses here has the same name in both.
    kinds = {"text": "rich_text"}
    out = {}
    for pid, column in schema.items():
        kind = kinds.get(column["type"], column["type"])
        body: dict = {}
        if "options" in column:
            body = {
                "options": [{
                    "id": opt["id"],
                    "name": opt["value"],
                    "color": opt.get("color", "default"),
                } for opt in column["options"]]
            }
        out[column["name"]] = {
            "id": "title" if pid == "title" else quote(pid, safe=""),
            "name": column["name"],
            "type": kind,
            kind: body,
        }
    return out


def date_of(value: list | None) -> dict | None:
    """Pull a date range out of a record-API date property.

    Args:
        value (list | None): the raw property value.

    Returns:
        dict | None: the REST date object, or None when unset.
    """
    if not value:
        return None
    for segment in value:
        for mark in segment[1] if len(segment) > 1 and segment[1] else []:
            if mark[0] == "d":
                spec = mark[1]
                return {
                    "start": spec.get("start_date"),
                    "end": spec.get("end_date"),
                    "time_zone": None,
                }
    return None


def row_properties(schema: dict, raw: dict) -> dict:
    """Convert one row's record-API properties into REST page properties.

    Only the column types the templates actually use are handled; anything
    else would be a silent wrong value, so it raises instead.

    Args:
        schema (dict): the collection's raw schema.
        raw (dict): the row's raw properties, keyed by property id.

    Returns:
        dict: REST-shaped page properties, keyed by column name.

    Raises:
        NotImplementedError: on a column type this does not convert.
    """
    out = {}
    for pid, column in schema.items():
        name, kind = column["name"], column["type"]
        value = raw.get(pid)
        ident = "title" if pid == "title" else quote(pid, safe="")
        if kind == "title":
            out[name] = {
                "id": "title",
                "type": "title",
                "title": rich_text(plain(value)),
            }
        elif kind == "text":
            out[name] = {
                "id": ident,
                "type": "rich_text",
                "rich_text": rich_text(plain(value)),
            }
        elif kind == "number":
            text = plain(value)
            out[name] = {
                "id": ident,
                "type": "number",
                "number": None if text == "" else float(text),
            }
        elif kind in ("select", "status"):
            text = plain(value)
            chosen = next(
                (o for o in column.get("options", []) if o["value"] == text),
                None)
            out[name] = {
                "id": ident,
                "type": kind,
                kind: None if chosen is None else {
                    "id": chosen["id"],
                    "name": chosen["value"],
                    "color": chosen.get("color", "default"),
                },
            }
        elif kind == "date":
            out[name] = {"id": ident, "type": "date", "date": date_of(value)}
        elif kind == "person":
            out[name] = {"id": ident, "type": "people", "people": []}
        else:
            raise NotImplementedError(f"column type {kind!r} ({name})")
    return out


def rows_of(collection_id: str, view_id: str) -> tuple[dict, list[dict]]:
    """Query one collection and return its schema and rows, in view order.

    Args:
        collection_id (str): the collection id.
        view_id (str): a view id belonging to that collection.

    Returns:
        tuple[dict, list[dict]]: the raw schema, and the rows as
        {"id", "properties"} in the order the view shows them.
    """
    body = {
        "source": {
            "type": "collection",
            "id": collection_id,
            "spaceId": SPACE
        },
        "collectionView": {
            "id": view_id,
            "spaceId": SPACE
        },
        "loader": {
            "reducers": {
                "collection_group_results": {
                    "type": "results",
                    "limit": 200
                }
            },
            "searchQuery": "",
            "userTimeZone": "America/Los_Angeles",
            "type": "results",
        },
    }
    payload = post("queryCollection?src=initial_load", body)
    record_map = payload["recordMap"]
    schema = schema_of(record_map, collection_id)
    order = payload["result"]["reducerResults"]["collection_group_results"][
        "blockIds"]
    rows = []
    for block_id in order:
        block = unwrap(record_map["block"][block_id])
        rows.append({
            "id":
            block_id,
            "properties":
            row_properties(schema, block.get("properties", {})),
        })
    return schema, rows


def block_payload(kind: str, child: dict) -> dict:
    """Build one REST block's payload from a record-API block.

    Args:
        kind (str): the record-API block type.
        child (dict): the raw block.

    Returns:
        dict: the payload the REST API puts under the block's type key.
    """
    properties = child.get("properties") or {}
    if kind == "divider":
        return {}
    if kind == "bookmark":
        # The record API keeps the URL in `link` and the fetched page title in
        # `title`; the REST API keeps the URL and calls the rest a caption.
        return {
            "url": plain(properties.get("link")),
            "caption": rich_text(plain(properties.get("title"))),
        }
    return {"rich_text": rich_text(plain(properties.get("title")))}


def build(page_id: str, title: str, defaults: dict) -> dict:
    """Read one subpage of the template and return it as a fixture.

    Args:
        page_id (str): the subpage's id.
        title (str): the subpage's title, as the fixture should record it.
        defaults (dict): the fixture's `defaults` block.

    Returns:
        dict: an authored fixture, in the vendor's own REST shape.
            `notion_rows.py` converts it to the rows mirage's kit seeds.

    Raises:
        NotImplementedError: the page carries a block type this cannot map.
    """
    chunk = post(
        "loadPageChunk", {
            "pageId": page_id,
            "limit": 200,
            "cursor": {
                "stack": []
            },
            "chunkNumber": 0,
            "verticalColumns": False,
        })
    record_map = chunk["recordMap"]
    page = unwrap(record_map["block"][page_id])

    databases: list[dict] = []
    pages: list[dict] = [{
        "id": page_id,
        "title": title,
        "parent": {
            "type": "workspace"
        },
    }]
    blocks: list[dict] = []

    for child_id in page["content"]:
        child = unwrap(record_map["block"][child_id])
        kind = child["type"]
        if kind == "collection_view":
            collection_id = child["collection_id"]
            collection = unwrap(record_map["collection"][collection_id])
            db_title = plain(collection["name"])
            schema, rows = rows_of(collection_id, child_id)
            databases.append({
                "id": collection_id,
                "title": db_title,
                "parent": {
                    "type": "page_id",
                    "id": page_id
                },
                "is_inline": True,
                "properties": db_properties(schema),
            })
            # A database that lives on a page is reachable two ways in the
            # REST API: as a database, and as a `child_database` block among
            # the page's children whose block id *is* the database id. Both
            # notion-hr's and oil-price's evaluators find their tables the
            # second way, so the block has to be here or the grade fails
            # before the agent is consulted.
            blocks.append({
                "id": collection_id,
                "parent": page_id,
                "type": "child_database",
                "payload": {
                    "title": db_title
                },
            })
            for row in rows:
                pages.append({
                    "id": row["id"],
                    "title": "",
                    "parent": {
                        "type": "database_id",
                        "id": collection_id
                    },
                    "properties": row["properties"],
                })
        elif kind in BLOCK_TYPES:
            blocks.append({
                "id": child_id,
                "parent": page_id,
                "type": BLOCK_TYPES[kind],
                "payload": block_payload(kind, child),
            })
        elif kind in DROPPED:
            continue
        else:
            raise NotImplementedError(f"block type {kind!r}")

    return {
        "defaults": defaults,
        "databases": databases,
        "pages": pages,
        "blocks": blocks,
        "comments": [],
    }
