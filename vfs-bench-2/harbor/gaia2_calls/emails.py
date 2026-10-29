"""The emails app's calls for gaia2_compare.py."""
import json

KNOWN: dict[str, str] = {}


def calls(state: dict, last):
    folders = state.get("folders") or {}
    inbox = folders.get("INBOX", {}).get("emails", [])
    sent = folders.get("SENT", {}).get("emails", [])
    user = state.get("user_email", "user@example.com")
    some = inbox[min(3, len(inbox) - 1)] if inbox else None
    unread = next((e for e in inbox if not e.get("is_read")), some)

    # Reads.
    yield "list-emails", {}
    yield "list-emails", {"folder_name": "sent"}
    yield "list-emails", {"folder_name": "Trash", "offset": 1, "limit": 2}
    yield "list-emails", {"folder_name": "DRAFT"}
    yield "list-emails", {"offset": 3, "limit": 4}
    yield "list-emails", {"offset": -1}
    yield "list-emails", {"offset": len(inbox)}
    yield "list-emails", {"offset": len(inbox) + 1}
    yield "list-emails", {"limit": -2}
    yield "list-emails", {"offset": 2, "limit": 0}
    yield "list-emails", {"folder_name": "SPAM"}
    yield "get-email-by-index", {"idx": 0}
    yield "get-email-by-index", {"idx": 2, "folder_name": "sent"}
    yield "get-email-by-index", {"idx": -1}
    yield "get-email-by-index", {"idx": len(inbox)}
    yield "get-email-by-index", {"idx": 0, "folder_name": "nowhere"}
    yield "get-email-by-index", {}
    if unread:
        yield "get-email-by-id", {"email_id": unread["email_id"]}
        yield "get-email-by-id", {
            "email_id": unread["email_id"],
            "folder_name": "sent"
        }
        yield "get-email-by-id", {
            "email_id": unread["email_id"],
            "folder_name": "inbox"
        }
    yield "get-email-by-id", {"email_id": "nope"}
    yield "get-email-by-id", {}
    if some:
        yield "search-emails", {"query": some["subject"][:6].upper()}
        yield "search-emails", {"query": some["sender"]}
        if some.get("recipients"):
            yield "search-emails", {"query": some["recipients"][0][:5]}
        yield "search-emails", {"query": some["content"][10:18]}
    if sent:
        yield "search-emails", {
            "query": sent[0]["subject"][:4].lower(),
            "folder_name": "sent"
        }
    yield "search-emails", {"query": "zzzz-none"}
    yield "search-emails", {"query": "", "folder_name": "trash"}
    yield "search-emails", {"query": "a", "folder_name": "outbox"}

    # send-email: its JSON lists are click usage errors, the rest errors.
    yield "send-email", {"recipients": "not json"}
    yield "send-email", {"recipients": '{"a": 1}'}
    yield "send-email", {"recipients": '"a@b.c"'}
    yield "send-email", {"recipients": "5"}
    yield "send-email", {"recipients": "1.0"}
    yield "send-email", {"recipients": "null"}
    yield "send-email", {"recipients": '["a@b.c"]', "cc": "[1"}
    yield "send-email", {"recipients": '["a@b.c"]', "attachment_paths": "true"}
    yield "send-email", {"subject": "no recipients"}
    yield "send-email", {"recipients": '["bob"]'}
    yield "send-email", {"recipients": '["a@b.c", 1, true, null]'}
    yield "send-email", {"recipients": '["a@b.c"]', "cc": '["carol"]'}
    yield "send-email", {
        "recipients": '["a@b.c"]',
        "attachment_paths": '["Documents/missing.pdf"]'
    }
    yield "send-email", {
        "recipients": '["a@b.c"]',
        "attachment_paths": '["../../../etc/passwd"]'
    }
    yield "send-email", {
        "recipients": '["a@b.c", ["x@y"], {"k": "v@w", "n": 1.5}, "名@例.jp"]',
        "subject": "Mixed — “list” ✓",
        "content": "Body\nwith 'quotes' and \"more\""
    }
    mixed_id = last()["email_id"]
    yield "get-email-by-id", {"email_id": mixed_id, "folder_name": "SENT"}
    yield "send-email", {
        "recipients":
        '["dana@example.com"]',
        "subject":
        "Report",
        "content":
        "Attached.",
        "cc":
        '["eve@example.com", "frank@example.com"]',
        "attachment_paths":
        '["/Downloads/llama2.pdf", "~/../../Documents/weatherHistory.csv"]'
    }
    report_id = last()["email_id"] if last() else mixed_id
    yield "send-email", {"recipients": "[]"}
    plain_id = last()["email_id"]
    yield "search-emails", {"query": "report", "folder_name": "SENT"}
    yield "list-emails", {"folder_name": "SENT", "limit": 4}

    # forward-email
    if some:
        yield "forward-email", {
            "email_id": some["email_id"],
            "recipients": '["gail@example.com"]'
        }
        fwd_id = last()["email_id"]
        yield "forward-email", {
            "email_id": some["email_id"],
            "recipients": '["gail"]'
        }
        yield "forward-email", {
            "email_id": some["email_id"],
            "recipients": "oops"
        }
        yield "forward-email", {
            "email_id": some["email_id"],
            "recipients": '["g@x"]',
            "folder_name": "SENT"
        }
    else:
        fwd_id = plain_id
    yield "forward-email", {
        "email_id": report_id,
        "recipients": '["hal@example.com"]',
        "folder_name": "sent"
    }
    yield "forward-email", {
        "email_id": "nope",
        "recipients": '["g@x"]',
        "folder_name": "nowhere"
    }
    yield "forward-email", {"recipients": '["g@x"]'}

    # download-attachments
    if some:
        yield "download-attachments", {"email_id": some["email_id"]}
    yield "download-attachments", {
        "email_id": report_id,
        "folder_name": "sent",
        "path_to_save": "Saved/mail"
    }
    yield "download-attachments", {
        "email_id": report_id,
        "folder_name": "",
        "path_to_save": "/Downloads/again/"
    }
    yield "download-attachments", {"email_id": report_id}
    yield "download-attachments", {"email_id": "nope", "folder_name": ""}
    yield "download-attachments", {
        "email_id": report_id,
        "folder_name": "sent",
        "path_to_save": "../.."
    }
    yield "send-email", {
        "recipients": '["i@example.com"]',
        "attachment_paths": '["Saved/mail/llama2.pdf"]'
    }

    # reply-to-email: to an email, to the user's own, and up a chain.
    if some:
        yield "reply-to-email", {
            "email_id": some["email_id"],
            "content": "Thanks!"
        }
        reply_id = last()["email_id"]
        yield "reply-to-email", {
            "email_id": reply_id,
            "folder_name": "SENT",
            "content": "Following up"
        }
        follow_id = last()["email_id"]
        yield "reply-to-email", {"email_id": follow_id, "folder_name": "sent"}
        yield "reply-to-email", {
            "email_id": fwd_id,
            "folder_name": "sent",
            "content": "fwd",
            "attachment_paths": '["Downloads/llama2.pdf"]'
        }
    yield "reply-to-email", {
        "email_id": plain_id,
        "folder_name": "SENT",
        "content": "self"
    }
    yield "reply-to-email", {"email_id": "nope", "content": "x"}
    yield "reply-to-email", {
        "email_id": plain_id,
        "folder_name": "SENT",
        "attachment_paths": "[nope"
    }
    yield "reply-to-email", {
        "email_id": plain_id,
        "folder_name": "SENT",
        "attachment_paths": '["nope.txt"]'
    }
    yield "reply-to-email", {"content": "x"}
    for e in sent[:3]:
        yield "reply-to-email", {
            "email_id": e["email_id"],
            "folder_name": "SENT",
            "content": "chain"
        }

    # move-email and delete-email
    if some:
        yield "move-email", {
            "email_id": some["email_id"],
            "source_folder_name": "inbox",
            "dest_folder_name": "trash"
        }
        yield "move-email", {
            "email_id": some["email_id"],
            "source_folder_name": "INBOX",
            "dest_folder_name": "TRASH"
        }
        yield "move-email", {
            "email_id": some["email_id"],
            "source_folder_name": "Trash",
            "dest_folder_name": "Trash"
        }
        yield "move-email", {
            "email_id": some["email_id"],
            "source_folder_name": "TRASH",
            "dest_folder_name": "spam"
        }
        yield "get-email-by-id", {
            "email_id": some["email_id"],
            "folder_name": "TRASH"
        }
    if len(inbox) > 6:
        yield "move-email", {
            "email_id": inbox[6]["email_id"],
            "source_folder_name": "INBOX",
            "dest_folder_name": "DRAFT"
        }
        yield "list-emails", {"folder_name": "DRAFT"}
    yield "move-email", {"email_id": plain_id, "source_folder_name": "SENT"}
    yield "move-email", {"email_id": plain_id}
    yield "delete-email", {"email_id": plain_id, "folder_name": "sent"}
    yield "delete-email", {"email_id": plain_id, "folder_name": "sent"}
    yield "delete-email", {"email_id": plain_id, "folder_name": "nowhere"}
    if len(inbox) > 1:
        yield "delete-email", {"email_id": inbox[1]["email_id"]}
    yield "delete-email", {"email_id": plain_id, "folder_name": "TRASH"}
    yield "list-emails", {"folder_name": "TRASH", "limit": 5}
    yield "delete-email", {}

    # Hidden ENV commands.
    yield "create-and-add-email", {
        "sender": "news@example.com",
        "subject": "Digest",
        "content": "Today"
    }
    new_id = last()["email_id"]
    yield "create-and-add-email", {"sender": "x@example.com", "recipients": ""}
    yield "create-and-add-email", {
        "sender": "x@example.com",
        "recipients": json.dumps([user, "z@z"]),
        "folder_name": "draft"
    }
    yield "create-and-add-email", {
        "sender": "x@example.com",
        "folder_name": "spam"
    }
    yield "create-and-add-email", {
        "sender": "x@example.com",
        "recipients": "{bad"
    }
    yield "create-and-add-email", {"subject": "no sender"}
    yield "get-email-by-id", {"email_id": new_id}
    yield "send-email-to-user-only", {
        "sender": "boss@example.com",
        "subject": "Now",
        "content": "Call me"
    }
    boss_id = last()["email_id"]
    yield "send-email-to-user-only", {"sender": "quiet@example.com"}
    yield "send-email-to-user-only", {}
    yield "reply-to-email", {"email_id": boss_id, "content": "On it"}
    yield "reply-to-email-from-user", {
        "sender": "dana@example.com",
        "email_id": report_id,
        "content": "Got it",
        "attachment_paths": '["Documents/weatherHistory.csv"]'
    }
    yield "reply-to-email-from-user", {
        "sender": "dana@example.com",
        "email_id": report_id
    }
    yield "reply-to-email-from-user", {
        "sender": "dana@example.com",
        "email_id": new_id
    }
    yield "reply-to-email-from-user", {
        "sender": "dana@example.com",
        "email_id": report_id,
        "attachment_paths": '["missing"]'
    }
    yield "reply-to-email-from-user", {
        "sender": "dana@example.com",
        "email_id": report_id,
        "attachment_paths": "{}"
    }
    yield "reply-to-email-from-user", {"email_id": report_id}
    yield "search-emails", {"query": "GOT IT"}
    yield "list-emails", {"limit": 3}
    yield "get-email-by-index", {"idx": 1}
