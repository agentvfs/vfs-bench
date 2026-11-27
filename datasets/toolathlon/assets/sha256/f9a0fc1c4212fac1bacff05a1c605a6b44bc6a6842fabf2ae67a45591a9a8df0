import json
from pathlib import Path

# The fixture shape mirage's kit seeds from, which is not the shape this
# repo authors. `notion_template.py` writes what the REST API returns --
# `{"parent": {"type": ..., "id": ...}, "properties": {...}}` -- because
# that is what a person reviewing a fixture can read against the vendor's
# own documentation. The kit seeds Prisma ROWS: one flat record per table,
# with the parent split across two columns and every nested value destined
# for a String column (`seed.ts:128` stringifies objects and arrays on the
# way in, so they stay JSON here).
#
# Converting rather than re-authoring keeps the reviewable file the source
# of truth and makes the row file a derived artifact `dvc status` watches,
# which is the same split every other fixture in this repo already has.

MAX_UPLOAD_SIZE = 5242880


def rich_text(text: str) -> list:
    """One plain run, in the vendor's rich-text shape.

    Args:
        text (str): the literal text.

    Returns:
        list: a single-element rich text array, empty when the text is.
    """
    if not text:
        return []
    return [{"type": "text", "plain_text": text, "text": {"content": text}}]


def url_for(base: str, ident: str) -> str:
    """The page URL the fake reports for an id.

    Args:
        base (str): the workspace url base, trailing slash included.
        ident (str): the object id, dashed.

    Returns:
        str: base plus the id with its dashes removed, which is how both
            Notion and mirage's fixture spell it.
    """
    return f"{base}{ident.replace('-', '')}"


def title_of(properties: dict) -> str:
    """The plain text of whichever property is the title.

    A database row carries its name inside `properties`, under whatever the
    database calls that column -- `Position`, `Name`, `Task`. The kit stores
    it a second time in `titleText`, denormalised, so it has to be found
    here rather than read off a fixed key.

    Args:
        properties (dict): the page's properties.

    Returns:
        str: the concatenated plain text, or "" when there is no title.
    """
    for value in (properties or {}).values():
        if value.get("type") == "title":
            return "".join(
                run.get("plain_text", "") for run in value.get("title") or [])
    return ""


def stamps(defaults: dict) -> dict:
    """The four audit columns every row carries, from the fixture defaults.

    Args:
        defaults (dict): the authored fixture's `defaults` block.

    Returns:
        dict: createdTime, lastEditedTime, createdBy and lastEditedBy.
    """
    return {
        "createdTime": defaults["created_time"],
        "lastEditedTime": defaults["last_edited_time"],
        "createdBy": defaults["created_by"],
        "lastEditedBy": defaults["last_edited_by"],
    }


def convert(authored: dict, workspace: str) -> dict:
    """One authored fixture, as the rows the kit seeds.

    Args:
        authored (dict): the fixture `notion_template.build` wrote.
        workspace (str): the task's workspace, which names the tenant and
            is what `ntn whoami` prints back.

    Returns:
        dict: a fixture keyed by the kit's `seedRoots` -- meta, databases,
            pages, blocks, comments.
    """
    defaults = authored["defaults"]
    base = defaults["url_base"]
    audit = stamps(defaults)

    # The workspace id and bot id are ours to choose and nothing reads them
    # as identifiers, but they have to be STABLE or every regeneration is a
    # diff. Derived from the workspace name rather than minted, for the same
    # reason the authored fixture pins its page ids.
    meta = {
        "workspaceName": workspace,
        "workspaceId": f"workspace-{workspace}",
        "botId": f"bot-{workspace}",
        "botName": workspace,
        "maxUploadSize": MAX_UPLOAD_SIZE,
        "urlBase": base,
        **audit,
    }

    databases = []
    for position, db in enumerate(authored["databases"]):
        parent = db.get("parent") or {"type": "workspace"}
        databases.append({
            "id": db["id"],
            "parentType": parent["type"],
            "parentId": parent.get("id"),
            "titleText": db["title"],
            "titleJson": rich_text(db["title"]),
            "descriptionJson": None,
            "propertiesJson": db.get("properties") or {},
            "isInline": bool(db.get("is_inline")),
            "inTrash": False,
            **audit,
            "url": url_for(base, db["id"]),
            "position": position,
        })

    pages = []
    for position, page in enumerate(authored["pages"]):
        parent = page.get("parent") or {"type": "workspace"}
        properties = page.get("properties") or {}
        # A page with a title and no properties is the subpage the template
        # was cut from; the vendor still reports a `title` property for it,
        # and `titleText` is denormalised from the same place either way.
        if not properties and page.get("title"):
            properties = {
                "title": {
                    "id": "title",
                    "type": "title",
                    "title": rich_text(page["title"]),
                }
            }
        pages.append({
            "id": page["id"],
            "parentType": parent["type"],
            "parentId": parent.get("id"),
            "titleText": page.get("title") or title_of(properties),
            "propertiesJson": properties,
            "iconJson": None,
            "coverJson": None,
            "inTrash": False,
            **audit,
            "url": url_for(base, page["id"]),
            "position": position,
        })

    blocks = []
    for position, block in enumerate(authored["blocks"]):
        blocks.append({
            "id": block["id"],
            "parentId": block["parent"],
            "position": position,
            "type": block["type"],
            "payloadJson": block.get("payload") or {},
            "hasChildren": False,
            "inTrash": False,
            **audit,
        })

    comments = []
    for position, comment in enumerate(authored.get("comments") or []):
        parent = comment.get("parent") or {"type": "page_id"}
        comments.append({
            "id":
            comment["id"],
            "parentType":
            parent["type"],
            "parentId":
            parent.get("id"),
            "discussionId":
            comment.get("discussion_id", comment["id"]),
            "richTextJson":
            comment.get("rich_text") or [],
            "createdTime":
            audit["createdTime"],
            "lastEditedTime":
            audit["lastEditedTime"],
            "createdBy":
            audit["createdBy"],
            "position":
            position,
        })

    return {
        "meta": meta,
        "databases": databases,
        "pages": pages,
        "blocks": blocks,
        "comments": comments,
    }


def render(source: Path, target: Path, workspace: str) -> dict:
    """Convert one authored fixture and write the rows beside it.

    Args:
        source (Path): the authored fixture.
        target (Path): where the rows go.
        workspace (str): the task's workspace.

    Returns:
        dict: the rows written.
    """
    rows = convert(json.loads(source.read_text(encoding="utf-8")), workspace)
    target.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n",
                      encoding="utf-8")
    return rows


def main() -> int:
    """Render one task's rows, or report that the committed copy drifted."""
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Convert a task's authored notion fixture into the rows "
        "mirage's kit seeds from.")
    parser.add_argument("task", help="the task name")
    parser.add_argument("--check",
                        action="store_true",
                        help="compare instead of writing")
    args = parser.parse_args()

    here = Path(__file__).resolve().parents[1] / args.task / "shared"
    source, target = here / "notion_fixture.json", here / "notion_rows.json"
    if not source.is_file():
        print(f"no authored fixture at {source}", file=sys.stderr)
        return 2
    # The workspace names the tenant, and it is read from the task rather
    # than passed in so the two cannot disagree: `stack.py` empties the same
    # file's `workspace` and the seeder resets it.
    workspace = json.loads(
        (here / "notion.json").read_text(encoding="utf-8"))["workspace"]

    if args.check:
        rows = convert(json.loads(source.read_text(encoding="utf-8")),
                       workspace)
        text = json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            print(f"{target} differs from {source.name}", file=sys.stderr)
            return 1
        print(f"{target.name} matches {source.name}")
        return 0

    rows = render(source, target, workspace)
    print(f"wrote {target} ({len(rows['databases'])} databases, "
          f"{len(rows['pages'])} pages, {len(rows['blocks'])} blocks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
