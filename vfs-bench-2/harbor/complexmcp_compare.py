"""Check each ComplexMCP kit fake against upstream's Python MCP server.

    uv run --project complexmcp python -I harbor/complexmcp_compare.py \
        [--task <n> ...] [--no-probes] [-v]

For each task (default: every one ``complexmcp.py`` commits), this logs
into upstream's servers as upstream's client does (``complexmcp/world.py``
starts them, unchanged) and resets a run of each fake from the task's
committed fixture, then:

- compares what each app's login answered (the starting environment);
- replays the task's reference trajectory (``data.parquet``'s ``output``),
  each call as upstream's client makes it, on both, and compares each reply
  with the other and with the one recorded;
- sends both the same probes: each tool of each server with values taken
  from the replies before (real ids and missing ones, every argument and
  wrong types), in a fixed order, so writes hit real rows;
- once, sends each plain server the calls of ``complexmcp_plain_probes.py``
  (every tool, edge values and errors), all but the random ones compared;
- compares what each app's logout answers (the end environment), types
  and all.

A reply is the text upstream's client hands the model: the tool's result as
fastmcp serializes it, or, when the call fails, the dict the client makes
of the error, as Python prints it. Every difference is printed, and the
script exits 1 on any. Upstream's Python ``set`` orders (a shop's starred
items, the watchlist) change with each process's string hashing; a reply
with one is compared as a set.
"""
import argparse
import asyncio
import functools
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import httpx
import pyarrow.parquet as pq
from fastmcp import Client

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
SRC = ROOT / "state" / "complexmcp" / "src"
sys.path[:0] = [str(HARBOR), str(ROOT / "complexmcp"), str(SRC)]
import complexmcp  # noqa: E402  (harbor/complexmcp.py)
import complexmcp_grade  # noqa: E402
from complexmcp_plain_probes import NONDETERMINISTIC, PROBES  # noqa: E402
from world import ComplexMCP  # noqa: E402  (complexmcp/world.py)


def _fakes():
    """vfsbench_harbor's shared fakes (fakes.py), without the package, which
    imports Harbor."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "fakes", HARBOR / "src" / "vfsbench_harbor" / "fakes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fakes = _fakes()

LIGHT = complexmcp.LIGHT
# The servers with a fake under mocks/.
SERVERS = [
    s for s in complexmcp.SERVERS
    if (ROOT / "mocks" / complexmcp.service(s) / "main.ts").is_file()
]


class Upstream:
    """Upstream's servers, logged in as its client logs in, called as its
    Toolbox calls them."""

    def __init__(self, world: ComplexMCP):
        self.world = world

    async def call(self, server: str, tool: str, arguments: dict) -> str:
        arguments = dict(arguments)
        if server in LIGHT:
            if server not in self.world.sessions:
                return str({
                    "status": "failed",
                    "output": f"{server} has not been logged into yet."
                })
            arguments["session_id"] = self.world.sessions[server]
        try:
            async with Client(self.world.urls.get(server)
                              or osint()) as client:
                result = await client.call_tool(tool, arguments)
                return result.content[0].text
        # Upstream's Toolbox catches every exception the same way.
        except Exception as error:  # noqa: BLE001
            return str({"status": "error", "output": str(error)})


def osint():
    """Upstream's OSINT server, which complexmcp/world.py leaves out, in this
    process, with none of the binaries it runs on PATH, as in upstream's
    sandbox image (python:3.11-slim installs none)."""
    import importlib.util
    os.environ["PATH"] = "/nonexistent"
    spec = importlib.util.spec_from_file_location(
        "osint_app", SRC / "servers" / "osint" / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.mcp


class Fakes:
    """A run of each fake, reset from the task's fixtures."""

    def __init__(self, runs: dict[str, str]):
        self.runs = runs
        self.client = httpx.AsyncClient(timeout=120)

    async def call(self, server: str, tool: str, arguments: dict) -> str:
        headers = {}
        if server in LIGHT:
            headers["x-light-system"] = self.runs["LightSystem"]
        reply = await self.client.post(f"{self.runs[server]}/{tool}",
                                       json=arguments,
                                       headers=headers)
        if reply.status_code != 200:
            return f"<HTTP {reply.status_code}: {reply.text}>"
        return reply.json()

    async def env(self, server: str, which: str):
        reply = await self.client.post(f"{self.runs[server]}/{which}")
        return reply.json()


SET_REPLIES = {("LightShop", "get_starred_shops"),
               ("LightShop", "get_my_starred_items"),
               ("LightStock", "get_watchlist_details")}

# A validation error prints the arguments with upstream's session id, which
# is random: its last characters stand for it on both sides.
SESSION = re.compile(r"\.\.\.[A-Za-z0-9]{22}'\}, input_type=dict")


def same(server: str, tool: str, a: str, b: str) -> bool:
    if a == b or SESSION.sub("<session>", a) == SESSION.sub("<session>", b):
        return True
    if (server, tool) in SET_REPLIES:
        try:
            x, y = json.loads(a), json.loads(b)
            key = lambda v: json.dumps(v, sort_keys=True)  # noqa: E731
            return sorted(map(key,
                              x["output"])) == sorted(map(key, y["output"]))
        except (ValueError, KeyError, TypeError):
            return False
    return False


def typed(value):
    """A value with Python's types made visible: 1 and 1.0 differ."""
    if isinstance(value, float):
        return ("float", repr(value))
    if isinstance(value, dict):
        return {k: typed(v) for k, v in value.items()}
    if isinstance(value, list):
        return [typed(v) for v in value]
    return value


def diff(a, b, path="") -> list[str]:
    if type(a) is not type(b):
        return [f"{path}: {a!r:.200} != {b!r:.200}"]
    if isinstance(a, dict):
        out = []
        for k in list(a) + [k for k in b if k not in a]:
            if k not in a or k not in b:
                out.append(f"{path}/{k}: only on one side")
            else:
                out += diff(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: {len(a)} items != {len(b)}"]
        return [
            d for i, (x, y) in enumerate(zip(a, b))
            for d in diff(x, y, f"{path}[{i}]")
        ]
    return [] if a == b else [f"{path}: {a!r:.200} != {b!r:.200}"]


class Check:

    def __init__(self, task: int, verbose: bool):
        self.task = task
        self.verbose = verbose
        self.calls = 0
        self.problems: list[str] = []
        self.trajectory: tuple[bool, dict] | None = None

    def fail(self, text: str) -> None:
        self.problems.append(text)
        print(f"  DIFF task {self.task}: {text}", flush=True)


async def both(check: Check,
               up: Upstream,
               fk: Fakes,
               server: str,
               tool: str,
               args: dict,
               recorded: str | None = None) -> str:
    a = await up.call(server, tool, args)
    b = await fk.call(server, tool, args)
    check.calls += 1
    if check.verbose:
        print("    "
              f"{server}.{tool}({json.dumps(args, ensure_ascii=False)[:120]}) "
              f"-> {a[:160]}")
    if not same(server, tool, a, b):
        check.fail(
            f"{server}.{tool}({json.dumps(args, ensure_ascii=False)[:300]})\n"
            f"      upstream: {a[:1500]}\n      fake:     {b[:1500]}")
    if recorded is not None and recorded != a:
        print(
            f"  note task {check.task}: {server}.{tool} answers otherwise than"
            f" recorded\n      recorded: {recorded[:300]}\n      now:      "
            f"{a[:300]}")
    return a


def ids(text: str, prefix: str) -> list[str]:
    return list(dict.fromkeys(re.findall(rf"\b{prefix}_[A-Za-z0-9]+", text)))


async def probes(check: Check, up: Upstream, fk: Fakes,
                 apps: list[str]) -> None:
    """Each tool of each logged-in app, and a call each to the others."""

    async def c(server, tool, **args):
        return await both(check, up, fk, server, tool, args)

    for app in LIGHT:
        if app not in apps and app != "LightSystem":
            await c(app, complexmcp.light_tools(app)[0]["tool_name"])
    await c("LightSystem", "now")
    await c("LightSystem", "health")
    if "LightTalk" in apps:
        t = "LightTalk"
        await c(t, "acc_network")
        contacts = json.loads(await c(t, "get_all_contacts"))["output"]
        uids = [x["uid"] for x in contacts]
        me = json.loads(await c(t, "get_myuid"))["output"]
        await c(t, "get_my_name")
        await c(t, "get_contacts", page=1)
        await c(t, "get_contacts", page=99)
        await c(t, "get_contacts", page=-1)
        await c(t, "get_uid_from_name", name=contacts[0]["name"])
        await c(t, "get_uid_from_name", name="Nobody Here")
        await c(t, "fuzzy_search_uids_from_name", name=contacts[1]["name"][:3])
        await c(t, "list_all_tags")
        await c(t, "get_contacts_by_tag", tag="family")
        await c(t, "get_contacts_by_tag", tag="nope")
        await c(t, "get_contacts_by_gender", gender="female")
        await c(t, "get_contacts_by_gender", gender="x")
        for uid in [*uids[:4], me, "user_missing"]:
            await c(t, "get_contact_info", uid=uid)
            await c(t, "get_chat_history", uid=uid)
            await c(t, "get_all_moments", uid=uid)
            await c(t, "get_last_k_moments", uid=uid, k=2)
            await c(t, "get_last_k_moments", uid=uid, k=0)
            await c(t, "get_moment", uid=uid, index=-1)
            await c(t, "get_moment", uid=uid, index=7)
        with_moments = [
            u for u in uids
            if '"moid"' in await up.call(t, "get_all_moments", {"uid": u})
        ]
        # Those calls drew from upstream's generator alone: draw the fake's
        # too.
        for u in uids:
            await fk.call(t, "get_all_moments", {"uid": u})
        blocked = [
            x["uid"] for x in contacts
            if "(blocked)" in await c(t, "get_uid_from_name", name=x["name"])
        ]
        await c(t, "send_message", uid=uids[0], content="hello 你好 \"quoted\"")
        await c(t, "send_message", uid="user_missing", content="x")
        await c(t, "send_image", uid=uids[1], img_url="http://x/y.png")
        await c(t, "delete_message", uid=uids[0], mid="msg_missing")
        await c(t, "ask_for_privilege")
        hist = await c(t, "get_chat_history", uid=uids[0])
        for mid in ids(hist, "msg")[:1]:
            await c(t, "delete_message", uid=uids[0], mid=mid)
        await c(t, "delete_message", uid=uids[0], mid="msg_missing")
        for uid in blocked[:1]:
            await c(t, "send_message", uid=uid, content="blocked?")
            await c(t, "like_moment", uid=uid, moid="mo_x")
            await c(t, "unblock", uid=uid)
            await c(t, "unblock", uid=uid)
            await c(t, "block", uid=uid)
        for uid in with_moments[:2]:
            ms = json.loads(await c(t, "get_all_moments", uid=uid))
            if ms["status"] != "ok":
                continue
            moid = ms["output"][-1]["moid"]
            await c(t, "like_moment", uid=uid, moid=moid)
            await c(t, "like_moment", uid=uid, moid="mo_missing")
            await c(t, "unlike_moment", uid=uid, moid=moid)
            await c(t, "unlike_moment", uid=uid, moid=moid)
            await c(t, "comment_moment", uid=uid, moid=moid, content="nice")
            ms = json.loads(await c(t, "get_all_moments", uid=uid))["output"]
            cids = [x["cid"] for m in ms for x in m["comments"]]
            mine = [
                x["cid"] for m in ms for x in m["comments"]
                if x["send_uid"] == me
            ]
            first = ms[0]["moid"]
            if cids:
                await c(t,
                        "comment_comment",
                        uid=uid,
                        moid=first,
                        cid=cids[0],
                        content="reply")
                await c(t,
                        "comment_comment",
                        uid=uid,
                        moid=first,
                        cid="com_missing",
                        content="reply")
                ms = json.loads(await c(t, "get_all_moments",
                                        uid=uid))["output"]
                nested = [
                    y["cid"] for m in ms for x in m["comments"]
                    for y in x["comments"]
                ]
                for cid in nested[:1]:
                    await c(t,
                            "withdraw_comment_comment",
                            uid=uid,
                            moid=first,
                            cid=cids[0],
                            my_cid=cid)
                await c(
                    t,
                    "withdraw_comment_comment",
                    uid=uid,
                    moid=first,
                    cid=cids[0],
                    my_cid=cids[0] if ms[0]["comments"]
                    and ms[0]["comments"][0]["send_uid"] != me else "com_x")
            for cid in mine[:1]:
                await c(t,
                        "withdraw_comment_moment",
                        uid=uid,
                        moid=first,
                        my_cid=cid)
            await c(t,
                    "withdraw_comment_moment",
                    uid=uid,
                    moid=first,
                    my_cid="com_missing")
            await c(t,
                    "comment_comment",
                    uid=uid,
                    moid="mo_missing",
                    cid="c",
                    content="x")
        await c(t,
                "comment_moment",
                uid=uids[0] if uids[0] not in with_moments else me,
                moid="mo_none",
                content="x")
        await c(t, "mark_as_read", uid=uids[2])
        await c(t, "mark_as_unread", uid=uids[2])
        await c(t, "edit_remark", uid=uids[2], remark="best friend")
        await c(t, "delete_remark", uid=uids[3])
        await c(t, "list_ip_choices")
        await c(t, "change_my_ip", where="Tokyo")
        await c(t, "change_my_ip", where="Mars")
        await c(t, "post_moment", content="my day", img_urls=["a.png"])
        mine = json.loads(await c(t, "get_my_moments"))["output"]
        for m in mine[:1]:
            await c(t, "get_shared_url_of_moment", uid=me, moid=m["moid"])
            await c(t, "delete_moment", moid=m["moid"])
        await c(t, "delete_moment", moid="mo_missing")
        await c(t, "get_shared_url_of_contact", uid=uids[0])
        await c(t, "create_group_chat", uids=uids[:3])
        await c(t, "create_group_chat", uids=["user_missing"])
        await c(t, "create_group_chat", uids=uids[3:5])
        groups = json.loads(await c(t, "list_all_groups"))["output"]
        g0, g1 = groups[0]["gid"], groups[1]["gid"]
        await c(t, "send_message_to_group", gid=g0, content="hi all", at="all")
        await c(t,
                "send_message_to_group",
                gid=g0,
                content="hi you",
                at=uids[:2])
        await c(t, "send_message_to_group", gid=g0, content="hi", at=[uids[4]])
        await c(t, "send_message_to_group", gid=g0, content="plain")
        await c(t, "send_message_to_group", gid=g0, content="str", at="ab")
        await c(t, "send_message_to_group", gid="group_missing", content="x")
        await c(t, "send_image_to_group", gid=g0, img_url="http://x/z.png")
        await c(t, "get_group_chat_history", gid=g0)
        await c(t, "get_group_chat_history", gid="group_missing")
        await c(t, "rename_group", gid=g0, name="Zeta Team")
        await c(t, "rename_group", gid=g1, name="Alpha Team")
        await c(t, "get_group_info", gid=g0)
        await c(t, "mark_as_unread_in_group", gid=g0)
        await c(t, "mark_as_read_in_group", gid=g1)
        await c(t, "invite_new_member", gid=g0, uid=uids[5])
        await c(t, "invite_new_member", gid=g0, uid="user_missing")
        await c(t, "quit_group", gid=g0)
        await c(t, "change_owner_of_group", gid=g1, uid=uids[3])
        await c(t, "quit_group", gid=g1)
        await c(t, "delete_group", gid=g0)
        await c(t, "delete_group", gid="group_missing")
        await c(t, "delete_chat_history", uid=uids[6])
        await c(t, "delete_contact", uid=uids[7])
        await c(t, "delete_contact", uid=me)
        await c(t, "get_uid_from_name", name=contacts[7]["name"])
        # Wrong types and missing arguments, as fastmcp refuses them.
        await c(t, "send_message", uid=uids[0])
        await c(t, "get_contacts", page="two")
        await c(t, "get_contacts", page=1.5)
        await c(t, "send_message", uid=5, content="x")
    if "LightShop" in apps:
        s = "LightShop"
        cats = json.loads(await c(s, "list_all_shop_categories"))["output"]
        names = json.loads(await c(s,
                                   "list_all_shops_by_category",
                                   category=cats[0]))["output"]
        await c(s, "list_all_shops_by_category", category="nope")
        sid = json.loads(await c(s, "get_shop_id_by_name",
                                 shop_name=names[0]))["output"]
        await c(s, "get_shop_id_by_name", shop_name="Nope Store")
        items = json.loads(await c(s, "list_items", sid=sid))["output"]
        await c(s, "list_items", sid="shop_missing")
        tid = items[0]["tid"]
        await c(s, "get_item_info", sid=sid, tid=tid)
        await c(s, "get_item_info", sid=sid, tid="item_missing")
        await c(s, "check_balance")
        await c(s, "get_cart_summary")
        await c(s, "search_shops", shop_name=names[0][:4])
        await c(s, "fuzzy_search_shops", shop_name=names[0][:-1])
        await c(s, "search_items", item_name=items[0]["name"][:4])
        await c(s, "fuzzy_search_items", item_name=items[0]["name"] + "s")
        await c(s,
                "search_items_in_shop",
                sid=sid,
                item_name=items[1]["name"][:3])
        await c(s,
                "fuzzy_search_items_in_shop",
                sid=sid,
                item_name=items[1]["name"][:-1])
        await c(s, "add_to_cart", sid=sid, tid=tid, cnt=1)
        await c(s, "add_to_cart", sid=sid, tid=tid, cnt=100000)
        await c(s, "add_to_cart", sid=sid, tid="item_missing", cnt=1)
        await c(s, "add_to_cart", sid=sid, tid=items[1]["tid"], cnt="2")
        await c(s, "checkout_all")
        for _ in range(4):
            await c(s, "wait_payment_password")
        await c(s, "checkout_all")
        await c(s, "checkout_all")
        await c(s, "get_cart_summary")
        await c(s, "add_to_cart", sid=sid, tid=tid, cnt=2)
        for caid in ids(await c(s, "get_cart_summary"), "cart")[:1]:
            await c(s, "delete_item_in_cart", caid=caid)
        await c(s, "delete_item_in_cart", caid="cart_missing")
        history = await c(s, "get_trans_history")
        for trid in ids(history, "trans")[:1]:
            await c(s, "get_trans_info", trid=trid)
            await c(s, "delete_trans_history", trid=trid)
        await c(s, "get_trans_info", trid="trans_missing")
        await c(s, "delete_trans_history", trid="trans_missing")
        await c(s, "star_shop", sid=sid)
        await c(s, "star_shop", sid=sid)
        await c(s, "get_starred_shops")
        await c(s, "unstar_shop", sid=sid)
        await c(s, "unstar_shop", sid=sid)
        await c(s, "star_item", sid=sid, tid=tid)
        await c(s, "star_item", sid=sid, tid=tid)
        await c(s, "star_item", sid=sid, tid=items[1]["tid"])
        await c(s, "get_my_starred_items")
        await c(s, "unstar_item", sid=sid, tid=tid)
        await c(s, "unstar_item", sid=sid, tid=tid)
        await c(s, "star_item", sid="shop_missing", tid=tid)
        await c(s, "check_balance")
        await c(s, "add_to_cart", sid=sid, tid=tid, cnt=1.0)
        await c(s, "add_to_cart", sid=sid, tid=tid)
        del cart
    if "LightFlight" in apps:
        f = "LightFlight"
        cities = json.loads(await c(f, "list_all_cities"))["output"]
        await c(f, "list_airports_by_city", city=cities[0])
        await c(f, "list_airports_by_city", city="Atlantis")
        fids = json.loads(await c(f,
                                  "get_fids_by_departure",
                                  departure=cities[0]))["output"]
        await c(f, "get_fids_by_departure", departure="Atlantis")
        await c(f, "get_fids_by_arrival", arrival=cities[1])
        await c(f, "get_fids_by_arrival", arrival="Atlantis")
        det = json.loads(await c(f, "get_flight_details",
                                 fid=fids[0]))["output"]
        await c(f, "get_flight_details", fid="flight_missing")
        day = det["depature_time"][:10]
        await c(f,
                "search_flights",
                departure=cities[0],
                arrival=det["arrival"].split(",")[0],
                date=day)
        await c(f,
                "search_flights",
                departure=cities[0],
                arrival=det["arrival"].split(",")[0],
                date=det["depature_time"])
        await c(f,
                "search_flights",
                departure=cities[0],
                arrival="Atlantis",
                date=day)
        await c(f,
                "search_flights",
                departure=cities[0],
                arrival="x",
                date="July 10")
        await c(f,
                "check_seat_availability",
                fid=fids[0],
                seat_class="business")
        await c(f,
                "check_seat_availability",
                fid=fids[0],
                seat_class="premium")
        await c(f, "check_passengers")
        await c(f, "add_passenger", name="Ann O'Neil", light_talk_uid="")
        await c(f, "add_passenger", name="Bo", light_talk_uid="user_x")
        await c(f,
                "add_to_booking",
                fid=fids[0],
                seat_class="first",
                passenger_idx=0)
        await c(f,
                "add_to_booking",
                fid=fids[1],
                seat_class="business",
                passenger_idx=1)
        await c(f,
                "add_to_booking",
                fid=fids[1],
                seat_class="economy",
                passenger_idx=9)
        await c(f,
                "add_to_booking",
                fid=fids[1],
                seat_class="premium",
                passenger_idx=0)
        await c(f,
                "add_to_booking",
                fid=fids[1],
                seat_class="economy",
                passenger_idx=-1)
        await c(f, "check_bookings")
        await c(f, "checkout_bookings")
        await c(f, "wait_payment_password")
        await c(f, "checkout_bookings")
        await c(f, "check_balance")
        bids = ids(await c(f, "check_bookings"), "booking")
        await c(f, "remove_from_booking", bid=bids[0])
        await c(f, "get_booking_history")
        await c(f, "cancel_booking", bids=bids[:1])
        await c(f, "cancel_booking", bids=["booking_missing"])
        await c(f,
                "add_to_booking",
                fid=fids[2],
                seat_class="economy",
                passenger_idx=0)
        bids = ids(await c(f, "check_bookings"), "booking")
        await c(f, "cancel_booking", bids=bids[-1:])
        await c(f, "remove_from_booking", bid=bids[-1])
        await c(f, "remove_from_booking", bid="booking_missing")
        await c(f, "remove_passenger", passenger_idx=1)
        await c(f, "remove_passenger", passenger_idx=5)
        await c(f, "remove_passenger", passenger_idx=-9)
        airports = json.loads(await c(f,
                                      "search_airports",
                                      airport_name="intl"))
        await c(f, "search_airports", airport_name="zzzz")
        if airports["status"] == "ok":
            aid = airports["output"][0]["aid"]
            await c(f, "star_airport", aid=aid)
            await c(f, "star_airport", aid=aid)
            await c(f, "get_my_starred_airports")
            await c(f, "unstar_airport", aid=aid)
            await c(f, "unstar_airport", aid=aid)
        await c(f, "star_airport", aid="nope")
        await c(f, "check_balance")
    if "LightStock" in apps:
        k = "LightStock"
        await c(k, "get_account_summary")
        sectors = json.loads(await c(k, "list_all_sectors"))["output"]
        tickers = json.loads(await
                             c(k,
                               "list_all_tickers_by_sector",
                               sector=f" {sectors[0].upper()} "))["output"]
        await c(k, "search_stocks", query="in")
        await c(k, "get_stock_details", ticker=tickers[0].lower())
        await c(k, "get_stock_details", ticker="ZZZZ")
        await c(k, "get_portfolio")
        await c(k, "get_pending_orders")
        await c(k, "get_trade_history")
        await c(k, "get_day_trades_remaining")
        await c(k, "check_vip_price")
        await c(k,
                "place_market_order",
                ticker=tickers[0],
                side="buy",
                quantity=1)
        await c(k, "wait_trade_password")
        await c(k,
                "place_market_order",
                ticker=tickers[0],
                side="buy",
                quantity=2)
        await c(k, "wait_trade_password")
        await c(k, "place_market_order", ticker="zzzz", side="buy", quantity=1)
        await c(k, "wait_trade_password")
        await c(k,
                "place_market_order",
                ticker=tickers[0],
                side="sell",
                quantity=1)
        await c(k, "wait_trade_password")
        await c(k,
                "place_market_order",
                ticker=tickers[1],
                side="sell",
                quantity=5)
        await c(k, "wait_trade_password")
        await c(k,
                "place_limit_order",
                ticker=tickers[1].lower(),
                side="buy",
                quantity=3,
                limit_price=10)
        await c(k, "wait_trade_password")
        await c(k,
                "place_limit_order",
                ticker=tickers[1],
                side="sell",
                quantity=1,
                limit_price=99.5)
        await c(k, "wait_trade_password")
        await c(k,
                "place_limit_order",
                ticker=tickers[1],
                side="buy",
                quantity=100000,
                limit_price=999.0)
        await c(k, "wait_trade_password")
        await c(k,
                "place_stop_loss_order",
                ticker=tickers[0],
                quantity=1,
                stop_price=1)
        await c(k, "transfer_funds", amount=100, direction="s2t")
        await c(k, "transfer_funds", amount=50.5, direction="t2s")
        await c(k, "transfer_funds", amount=10**9, direction="s2t")
        await c(k, "transfer_funds", amount=10**9, direction="up")
        orders = await c(k, "get_pending_orders")
        for oid in ids(orders, "order")[:2]:
            await c(k, "cancel_order", oid=oid)
        await c(k, "cancel_order", oid="order_missing")
        await c(k, "toggle_watchlist", ticker=tickers[0])
        await c(k, "toggle_watchlist", ticker=tickers[1].lower())
        await c(k, "get_watchlist_details")
        await c(k, "toggle_watchlist", ticker=tickers[0])
        await c(k, "toggle_watchlist", ticker="ZZZZ")
        await c(k, "set_price_alert", ticker=tickers[0], price=12)
        await c(k, "set_price_alert", ticker=tickers[0].lower(), price=1)
        await c(k, "remove_price_alert", ticker=tickers[0])
        await c(k, "remove_price_alert", ticker=tickers[0])
        await c(k, "set_price_alert", ticker=tickers[1], price=3.25)
        await c(k, "upgrade_to_vip")
        await c(k, "wait_trade_password")
        await c(k, "upgrade_to_vip")
        await c(k, "get_day_trades_remaining")
        await c(k, "wait_trade_password")
        await c(k,
                "place_stop_loss_order",
                ticker=tickers[0],
                quantity=1,
                stop_price=1)
        await c(k, "wait_trade_password")
        await c(k,
                "place_stop_loss_order",
                ticker=tickers[0],
                quantity=1,
                stop_price=10**6)
        await c(k, "wait_trade_password")
        await c(k,
                "place_market_order",
                ticker=tickers[2],
                side="sell",
                quantity=3)
        await c(k, "get_portfolio")
        await c(k, "get_trade_history")
        await c(k, "get_account_summary")
    if "LightNews" in apps:
        n = "LightNews"
        sections = json.loads(await c(n, "list_all_sections"))["output"]
        for sec in sections:
            await c(n, "get_last_k_news", section=sec, k=3)
        last = json.loads(await c(n,
                                  "get_last_k_news",
                                  section=sections[0],
                                  k=0))["output"]
        await c(n, "get_last_k_news", section="Nope", k=3)
        await c(n, "get_details", nid=last[0]["nid"])
        await c(n, "get_details", nid="news_missing")
        await c(n, "get_news_url", nid=last[0]["nid"])
        await c(n, "search", section=sections[0], query="the", maxn=5)
        await c(n,
                "search",
                section=sections[0],
                query="a",
                maxn=50,
                begin_date="2025-06-01",
                end_date="2026-01-01 00:00:00")
        await c(n,
                "search",
                section=sections[0],
                query="a",
                maxn=3,
                begin_date="2025-06-01T00:00:00+00:00")
        await c(n,
                "search",
                section=sections[0],
                query="a",
                maxn=3,
                begin_date="June 1")
        await c(n, "search", section="Nope", query="a", maxn=3)
    if "LightWeather" in apps:
        w = "LightWeather"
        cities = json.loads(await c(w, "list_cities"))["output"]
        for city in cities[:2] + ["Atlantis"]:
            await c(w, "get_current_weather", location=city)
            await c(w, "get_forecast", location=city, days=3)
            await c(w, "get_hourly_forecast", location=city, hours=5)
            await c(w, "get_uv_index", location=city)
            await c(w, "get_air_quality", location=city)
            await c(w, "get_sun_times", location=city)
            await c(w, "get_precip_probability", location=city, next_hours=4)
            await c(w, "get_wind_forecast", location=city, hours=3)
            await c(w, "get_climate_summary", location=city, year=2020)
            await c(w,
                    "get_historical_weather",
                    location=city,
                    start="2020-01-01",
                    end="2030-01-01")
        await c(w,
                "get_historical_weather",
                location=cities[0],
                start="2030-01-01",
                end="2020-01-01")
        await c(w,
                "get_historical_weather",
                location=cities[0],
                start="x",
                end="2020-01-01")
        stations = json.loads(await c(w, "list_stations"))["output"]
        await c(w, "get_station_info", station_id=stations[0]["id"])
        await c(w, "get_station_info", station_id="nope")
        await c(w, "get_station_observation", station_id=stations[0]["id"])
        await c(w, "get_station_observation", station_id="nope")
        await c(w, "compare_climate", location1=cities[0], location2=cities[1])
        await c(w,
                "compare_climate",
                location1=cities[0],
                location2="Atlantis")
        await c(w, "estimate_travel_weather", route=[cities[0], "Atlantis"])
        for args in [(100, "F", "C"), (0, "c", "k"), (300, "K", "F"),
                     (12.5, "c", "c")]:
            await c(w,
                    "convert_temperature",
                    value=args[0],
                    from_unit=args[1],
                    to_unit=args[2])
        alert = json.loads(await c(w,
                                   "create_alert",
                                   location=cities[0],
                                   condition="rain",
                                   threshold=5))
        await c(w,
                "create_alert",
                location="Atlantis",
                condition="rain",
                threshold=5)
        await c(w, "get_weather_alerts", location=cities[0])
        await c(w, "list_alerts")
        await c(w, "delete_alert", alert_id=alert["output"]["aid"])
        await c(w, "delete_alert", alert_id="nope")
        await c(w,
                "create_alert",
                location=cities[1],
                condition="wind",
                threshold=40.5)
        await c(w, "get_primary_location")
        await c(w, "set_primary_location", location=cities[1])
        await c(w, "set_primary_location", location="Atlantis")
        await c(w, "get_primary_location")


@functools.cache
def tasks_json() -> list[dict]:
    return json.loads((SRC.parent / "tasks.json").read_text())


def trajectory(row: dict) -> list[tuple[dict, str]]:
    """The reference trajectory's calls, each with the reply recorded."""
    output = json.loads(row["output"])
    out = []
    for call, reply in re.findall(
            r"<tool>(.*?)</tool>\s*<response>\n(.*?)\n</response>", output,
            re.S):
        try:
            out.append((json.loads(call.strip()), reply))
        except ValueError:
            continue
    return out


async def check_task(index: int, row: dict, slug: str, verbose: bool,
                     with_probes: bool, plain: bool, logs: Path) -> Check:
    check = Check(index, verbose)
    apps = json.loads(row["apps"])
    seed = int(row["seed"])
    world = await asyncio.to_thread(ComplexMCP, str(SRC))
    pool = fakes.pool()
    run = f"cmp-{index}-{os.getpid()}"
    opened = []
    try:
        await asyncio.to_thread(world.reset, {
            "seed": seed,
            "apps": apps
        }, None)
        up = Upstream(world)
        runs = {}
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "login.json"
            fixture.write_bytes(complexmcp.login_fixture(seed, apps))
            none = Path(tmp) / "none.json"
            none.write_bytes(complexmcp.EMPTY_FIXTURE)
            for server in SERVERS:
                service = complexmcp.service(server)
                name = pool.register(service, slug,
                                     fixture if server in LIGHT else none)
                fake = await asyncio.to_thread(pool.fake, service, name,
                                               "node", dict(os.environ), logs)
                opened.append(await pool.open(fake, run, name, None))
                runs[server] = opened[-1].url
        fk = Fakes(runs)
        for app in ["LightSystem", *apps]:
            a = world.initial[app]
            b = await fk.env(app, "login")
            for d in diff(typed(a), typed(b), f"{app} login"):
                check.fail(d)
        registry = complexmcp.registry()
        for call, recorded in trajectory(row):
            key = call.get("name")
            if key not in registry:
                continue
            server, tool = registry[key]
            await both(check, up, fk, server, tool,
                       call.get("arguments") or {}, recorded)
        # Whether the trajectory, as the oracle replays it, passes the judge.
        envs = [{
            app: await fk.env(app, which)
            for app in ["LightSystem", *apps]
        } for which in ("login", "logout")]
        result, _ = complexmcp_grade.judged(tasks_json()[index], *envs)
        check.trajectory = (result["recall"] == result["total"]
                            and result["misbehave"] == 0, result)
        if with_probes:
            await probes(check, up, fk, apps)
        if plain:
            for server, calls in PROBES.items():
                for tool, args in calls:
                    a = await up.call(server, tool, args)
                    b = await fk.call(server, tool, args)
                    check.calls += 1
                    if a != b and (server, tool) not in NONDETERMINISTIC:
                        check.fail(
                            f"{server}.{tool}({json.dumps(args)[:200]})\n"
                            f"      upstream: {a[:600]}\n      fake:     "
                            f"{b[:600]}")
        final = await asyncio.to_thread(world.finish)
        for app in ["LightSystem", *apps]:
            b = await fk.env(app, "logout")
            for d in diff(typed(final[app]), typed(b), f"{app} logout"):
                check.fail(d)
        await fk.client.aclose()
    finally:
        for r in opened:
            await pool.drop(r)
        world.close()
    return check


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--task", type=int, action="append")
    parser.add_argument("--no-probes", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    rows = pq.read_table(SRC / "benchmark" / "data" /
                         "data.parquet").to_pylist()
    tasks = args.task or [i for i in complexmcp.TASKS.values()]
    slugs = {i: s for s, i in complexmcp.TASKS.items()}
    logs = ROOT / "state" / "harbor" / "complexmcp-compare"
    failed = 0
    for n, index in enumerate(tasks):
        # The plain servers keep nothing, so their probes run once.
        check = await check_task(index, rows[index],
                                 slugs.get(index, f"task-{index}"),
                                 args.verbose, not args.no_probes, n == 0
                                 and not args.no_probes, logs)
        status = "FAIL" if check.problems else "ok"
        print(
            f"{status} task {index} ({slugs.get(index)}): {check.calls} "
            "calls, "
            f"{len(check.problems)} differences",
            flush=True)
        if check.trajectory is not None:
            ok, result = check.trajectory
            print(
                f"  trajectory task {index}: {'passes' if ok else 'fails'} "
                f"the judge {result}",
                flush=True)
        failed += bool(check.problems)
    print(f"{len(tasks) - failed} of {len(tasks)} tasks the same")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
