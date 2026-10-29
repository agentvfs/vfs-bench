"""The messages app's calls for gaia2_compare.py (the chats app's too)."""
import json
from datetime import datetime, timezone

KNOWN: dict[str, str] = {}


def _date(ts) -> str:
    return datetime.fromtimestamp(
        int(ts), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def calls(state: dict, last):
    convs = list(state["conversations"].values())
    me = state["current_user_id"]
    names = list(state["name_to_id"])
    others = [uid for uid in state["id_to_name"] if uid != me]
    group = next(c for c in convs if len(c["participant_ids"]) >= 3)
    pair = next(c for c in convs
                if len(c["participant_ids"]) == 2 and c["messages"])
    other = next(p for p in pair["participant_ids"] if p != me)
    first = max(convs, key=lambda c: len(c["messages"]))
    cid = first["conversation_id"]
    stamps = sorted(m["timestamp"] for m in first["messages"])
    mid = _date(stamps[len(stamps) // 2])
    words = [
        w.strip(".,!?") for m in first["messages"]
        for w in m["content"].split()
    ]
    word = next(w for w in words if len(w) >= 6 and w.isalpha())

    # Users.
    yield "get-user-id", {"user_name": names[0]}
    yield "get-user-id", {"user_name": "Nobody Here"}
    yield "get-user-name-from-id", {"user_id": others[0]}
    yield "get-user-name-from-id", {"user_id": "nope"}
    yield "lookup-user-id", {"user_name": names[1]}
    yield "lookup-user-id", {"user_name": "  " + names[1].upper()[:-1] + " \t"}
    yield "lookup-user-id", {"user_name": names[2].split()[0].lower()}
    yield "lookup-user-id", {"user_name": names[3].split()[-1]}
    yield "lookup-user-id", {"user_name": "zz"}
    yield "lookup-user-id", {"user_name": ""}

    # Listing.
    yield "list-recent-conversations", {}
    yield "list-recent-conversations", {
        "offset": 3,
        "limit": 2,
        "offset_recent_messages_per_conversation": 1,
        "limit_recent_messages_per_conversation": 3
    }
    yield "list-recent-conversations", {"limit": 6}
    yield "list-recent-conversations", {"offset": -1}
    yield "list-recent-conversations", {"offset": len(convs) + 1}
    yield "list-recent-conversations", {"offset": len(convs)}
    yield "list-recent-conversations", {"offset": len(convs) - 2}
    yield "list-recent-conversations", {"limit": -2}
    yield "list-recent-conversations", {
        "limit_recent_messages_per_conversation": 11
    }
    yield "list-recent-conversations", {
        "offset_recent_messages_per_conversation": -1
    }
    yield "list-recent-conversations", {
        "limit_recent_messages_per_conversation": -3
    }
    yield "list-recent-conversations", {
        "offset_recent_messages_per_conversation": 50
    }
    yield "list-conversations-by-participant", {"user_id": other}
    yield "list-conversations-by-participant", {
        "user_id": other[:4],
        "offset": 1,
        "limit": 3,
        "limit_recent_messages_per_conversation": 2
    }
    yield "list-conversations-by-participant", {"user_id": "nope"}
    yield "list-conversations-by-participant", {"user_id": other, "limit": 9}
    yield "list-conversations-by-participant", {"user_id": other, "offset": -2}
    yield "list-conversations-by-participant", {
        "user_id": other,
        "offset": len(convs) + 3
    }
    yield "list-conversations-by-participant", {
        "user_id": other,
        "limit_recent_messages_per_conversation": 12
    }

    # Reading.
    yield "read-conversation", {"conversation_id": cid}
    yield "read-conversation", {
        "conversation_id": cid,
        "offset": 2,
        "limit": 3
    }
    yield "read-conversation", {"conversation_id": cid, "offset": -1}
    yield "read-conversation", {"conversation_id": "nope"}
    yield "read-conversation", {"conversation_id": cid, "offset": 999}
    yield "read-conversation", {
        "conversation_id": cid,
        "offset": len(first["messages"])
    }
    yield "read-conversation", {"conversation_id": cid, "limit": -1}
    yield "read-conversation", {"conversation_id": cid, "min_date": mid}
    yield "read-conversation", {
        "conversation_id": cid,
        "max_date": mid,
        "limit": 2
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "min_date": mid,
        "max_date": mid
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "min_date": "2024-1-5 3:4:5"
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "min_date": "2024-13-01 00:00:00"
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "min_date": "2024-02-30 00:00:00"
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "min_date": "2024-01-01 00:00:60"
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "max_date": "2024-01-01"
    }
    yield "read-conversation", {
        "conversation_id": cid,
        "max_date": "2024-01-01 00:00:00 extra"
    }
    yield "read-conversation", {"conversation_id": cid, "max_date": "it's"}

    # Searching.
    yield "search", {"query": word.upper()}
    yield "search", {"query": other[:5]}
    yield "search", {"query": (group.get("title") or "x")[:6].lower()}
    yield "search", {"query": word, "min_date": mid}
    yield "search", {"query": word, "max_date": mid}
    yield "search", {"query": "zzzqqq", "max_date": "bad date"}
    yield "search", {"query": "zzzqqq"}
    yield "search", {"query": ""}
    yield "regex-search", {"query": rf"\b{word}\b"}
    yield "regex-search", {"query": "^" + word[:3]}
    yield "regex-search", {"query": r"(dinner|lunch|coffee)\s+\w+"}
    yield "regex-search", {"query": r"[0-9]{1,2}(:|\.)[0-9]{2}"}
    yield "regex-search", {"query": r"(?P<c>[aeiou])(?P=c)"}
    yield "regex-search", {"query": r"\?$"}
    yield "regex-search", {"query": "(unclosed"}
    yield "regex-search", {"query": "*bad"}
    yield "regex-search", {"query": r"bad\q"}
    yield "regex-search", {"query": r"(?<=a+)b"}
    yield "regex-search", {
        "query": word,
        "min_date": mid,
        "max_date": "2030-01-01 00:00:00"
    }
    yield "regex-search", {"query": "zzzqqq", "min_date": "nope"}

    # Existing conversations.
    yield "get-existing-conversation-ids", {"user_ids": json.dumps([other])}
    yield "get-existing-conversation-ids", {
        "user_ids":
        json.dumps([p for p in group["participant_ids"] if p != me])
    }
    yield "get-existing-conversation-ids", {
        "user_ids": json.dumps(group["participant_ids"])
    }
    yield "get-existing-conversation-ids", {"user_ids": "[]"}
    yield "get-existing-conversation-ids", {"user_ids": "not json"}
    yield "get-existing-conversation-ids", {"user_ids": "5"}
    yield "get-existing-conversation-ids", {"user_ids": '"ab"'}
    yield "get-existing-conversation-ids", {"user_ids": "[[1]]"}

    # Sending.
    yield "send-message", {
        "user_id": other,
        "content": "Hi there — on my way ✓"
    }
    sent = last()
    yield "read-conversation", {"conversation_id": sent, "limit": 2}
    yield "send-message", {"user_id": others[-1]}
    yield "read-conversation", {"conversation_id": last()}
    yield "send-message", {"user_id": "nobody", "content": "x"}
    yield "send-message", {"user_id": "+1 555 0100", "content": "new number"}
    yield "send-message", {"user_id": me, "content": "note to self"}
    yield "send-message", {
        "user_id": other,
        "attachment_path": "/Documents/missing.txt"
    }
    yield "send-message", {
        "user_id": other,
        "attachment_path": "../../../etc/passwd"
    }
    yield "send-message", {
        "user_id": other,
        "content": "pic",
        "attachment_path": "/Pictures/llama.jpg"
    }
    yield "read-conversation", {"conversation_id": last(), "limit": 10}
    with_pic = next(
        (m["message_id"] for m in last()["messages"] if m["content"] == "pic"),
        "none")
    yield "download-attachment", {
        "conversation_id": sent,
        "message_id": with_pic
    }
    # No scenario's drive has a file that is not empty, so these attach and
    # download one only where a file is put there (the downloaded path is the
    # run's own drive).
    yield "send-message", {
        "user_id": other,
        "content": "note",
        "attachment_path": "~/../../Documents/vfs-note.txt"
    }
    yield "read-conversation", {"conversation_id": sent, "limit": 10}
    note = next((m["message_id"]
                 for m in last()["messages"] if m["content"] == "note"),
                "none")
    yield "download-attachment", {"conversation_id": sent, "message_id": note}
    yield "download-attachment", {
        "conversation_id": sent,
        "message_id": note,
        "download_path": "Saved/sub"
    }
    yield "download-attachment", {
        "conversation_id": sent,
        "message_id": note,
        "download_path": "/../.."
    }
    yield "download-attachment", {"conversation_id": cid, "message_id": "nope"}
    yield "download-attachment", {
        "conversation_id": "nope",
        "message_id": "x",
        "download_path": "Docs/"
    }
    yield "get-existing-conversation-ids", {"user_ids": json.dumps([other])}

    # Groups.
    yield "create-group-conversation", {"user_ids": json.dumps(others[:2])}
    g = last()
    yield "create-group-conversation", {
        "user_ids": json.dumps(others[2:5]),
        "title": "Trip ✈"
    }
    yield "create-group-conversation", {
        "user_ids": json.dumps(others[5:7]),
        "title": ""
    }
    yield "create-group-conversation", {"user_ids": json.dumps([others[0]])}
    yield "create-group-conversation", {
        "user_ids": json.dumps([others[0], me])
    }
    yield "create-group-conversation", {
        "user_ids": json.dumps([others[0], others[0]])
    }
    yield "create-group-conversation", {
        "user_ids": json.dumps([others[0], "nobody"])
    }
    yield "create-group-conversation", {
        "user_ids": json.dumps([others[0], "+44 20 7946 0000"])
    }
    yield "create-group-conversation", {"user_ids": "{bad"}
    yield "create-group-conversation", {"user_ids": "7"}
    yield "create-group-conversation", {"user_ids": "null"}
    yield "create-group-conversation", {"user_ids": json.dumps([[1], "x"])}
    yield "create-group-conversation", {"user_ids": json.dumps([1, 2])}
    yield "get-existing-conversation-ids", {"user_ids": json.dumps(others[:2])}
    yield "send-message-to-group-conversation", {
        "conversation_id": g,
        "content": "hello all"
    }
    yield "send-message-to-group-conversation", {
        "conversation_id": pair["conversation_id"],
        "content": "x"
    }
    yield "send-message-to-group-conversation", {"conversation_id": "nope"}
    yield "send-message-to-group-conversation", {
        "conversation_id": g,
        "attachment_path": "/nope.pdf"
    }
    yield "send-message-to-group-conversation", {
        "conversation_id": g,
        "attachment_path": "Downloads/llama2.pdf"
    }
    yield "read-conversation", {"conversation_id": g}
    yield "add-participant-to-conversation", {
        "conversation_id": g,
        "user_id": others[3]
    }
    yield "add-participant-to-conversation", {
        "conversation_id": g,
        "user_id": others[3]
    }
    yield "add-participant-to-conversation", {
        "conversation_id": g,
        "user_id": "+99 123"
    }
    yield "add-participant-to-conversation", {
        "conversation_id": "nope",
        "user_id": "x"
    }
    yield "read-conversation", {"conversation_id": g}
    yield "remove-participant-from-conversation", {
        "conversation_id": g,
        "user_id": others[0]
    }
    yield "remove-participant-from-conversation", {
        "conversation_id": g,
        "user_id": others[0]
    }
    yield "remove-participant-from-conversation", {
        "conversation_id": "nope",
        "user_id": "x"
    }
    yield "change-conversation-title", {
        "conversation_id": g,
        "title": "Renamed ✓"
    }
    yield "change-conversation-title", {
        "conversation_id": "nope",
        "title": "x"
    }
    yield "add-participant-to-conversation", {
        "conversation_id": g,
        "user_id": others[0]
    }
    yield "list-conversations-by-participant", {"user_id": others[3]}
    yield "create-and-add-message", {
        "conversation_id": g,
        "sender_id": others[3],
        "content": "npc msg here"
    }
    yield "create-and-add-message", {
        "conversation_id": g,
        "sender_id": "stranger"
    }
    yield "create-and-add-message", {
        "conversation_id": "nope",
        "sender_id": "x"
    }
    yield "create-and-add-message", {
        "conversation_id": pair["conversation_id"],
        "sender_id": other
    }
    yield "list-recent-conversations", {
        "limit": 4,
        "limit_recent_messages_per_conversation": 2
    }
    yield "search", {"query": "NPC"}
    yield "regex-search", {"query": r"npc\s+MSG"}
    yield "read-conversation", {
        "conversation_id": pair["conversation_id"],
        "limit": 3
    }
