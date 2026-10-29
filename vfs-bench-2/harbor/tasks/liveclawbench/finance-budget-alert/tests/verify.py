#!/usr/bin/env python3
"""
Verifier for finance-budget-alert task.

Checks:
  - finance_data_intact (0.0): Corrupted March 2026 records exist in finance DB (diagnostic only)
  - email_sent_count (0.35): Correct number of alert emails sent (3 expected)
  - correct_recipients (0.35): Emails sent to correct manager addresses
  - email_content (0.30): Emails mention the department name and violation type

Violating departments (3):
  - Engineering: over budget (180K > 150K), manager: eng.manager@example.com
  - Sales: negative actual expense (-5K), manager: sales.manager@example.com
  - Marketing: over budget (200K > 150K), manager: marketing.manager@example.com

Non-violating (3):
  - HR, Finance, Operations

Aggregate score = sum of earned weights.

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail
from the gws fake's run SQLite in place of the email mock's, with every
check and weight of upstream's verifier kept, its finance checks as they
are. A sent message's recipients are its To addresses, each checked as
upstream checks its one recipient_email.
"""

import json
import os
import sqlite3
import sys
import traceback
from email.utils import getaddresses

FINANCE_DB_PATH = os.environ.get(
    "MOCK_FINANCE_DB_PATH", "/opt/mock/data/finance_app.sqlite"
)
GWS_DB_PATH = "/var/lib/mock-data/gws/gws.db"


def sent_emails(conn):
    """Each sent email in the gws fake's run, as (recipients, subject, body).

    Upstream's email mock keeps an email as one row, a sent one with
    folder='sent' and its one recipient_email. The gws fake keeps a Gmail
    message with its labels and headers: a sent one is labelled SENT and not
    TRASH, and its recipients are the addresses in its To header.
    """
    sent = []
    rows = conn.execute(
        "SELECT id, bodyText FROM Message m WHERE EXISTS (SELECT 1 FROM "
        "MessageLabel l WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'SENT') AND NOT EXISTS (SELECT 1 FROM MessageLabel l "
        "WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'TRASH') ORDER BY seq").fetchall()
    for message_id, body in rows:
        headers = conn.execute(
            "SELECT name, value FROM MessageHeader WHERE messageId = ? "
            "ORDER BY seq", (message_id, )).fetchall()
        to = [v for n, v in headers if n.lower() == "to"]
        subject = next((v for n, v in headers if n.lower() == "subject"), "")
        sent.append(([a for _, a in getaddresses(to)], subject, body))
    return sent

VIOLATING_DEPTS = {
    "Engineering": {
        "manager_email": "eng.manager@example.com",
        "violation": "over_budget",
        "budget": 150000.0,
        "actual": 180000.0,
    },
    "Sales": {
        "manager_email": "sales.manager@example.com",
        "violation": "negative_expense",
        "budget": 150000.0,
        "actual": -5000.0,
    },
    "Marketing": {
        "manager_email": "marketing.manager@example.com",
        "violation": "over_budget",
        "budget": 150000.0,
        "actual": 200000.0,
    },
}

EXPECTED_RECIPIENTS = {v["manager_email"] for v in VIOLATING_DEPTS.values()}

WEIGHTS = {
    "finance_data_intact": 0.0,  # diagnostic only — seed integrity is env-guaranteed
    "email_sent_count": 0.35,
    "correct_recipients": 0.35,
    "email_content": 0.30,
}


def record_score(
    details: dict,
    dimension: str,
    passed: bool,
    pass_msg: str,
    fail_msg: str,
) -> float:
    """Record a dimension score and message, returning the earned weight."""
    if passed:
        details["dimension_scores"][dimension] = WEIGHTS[dimension]
        details["messages"].append(f"PASS: {pass_msg}")
        return WEIGHTS[dimension]
    details["dimension_scores"][dimension] = 0.0
    details["messages"].append(f"FAIL: {fail_msg}")
    return 0.0


def check_finance_data(conn: sqlite3.Connection) -> bool:
    """Check that the corrupted March 2026 records exist in the finance DB."""
    rows = conn.execute(
        "SELECT department_name, budget_amount, actual_expense_amount "
        "FROM department_financial_record WHERE month = '2026-03'"
    ).fetchall()

    if len(rows) < 6:
        return False

    found = {(row[0], row[1], row[2]) for row in rows}
    expected = {
        ("Engineering", 150000.0, 180000.0),
        ("Sales", 150000.0, -5000.0),
        ("Marketing", 150000.0, 200000.0),
        ("HR", 150000.0, 120000.0),
        ("Finance", 150000.0, 140000.0),
        ("Operations", 150000.0, 130000.0),
    }
    return expected.issubset(found)


def main() -> tuple[float, dict]:
    score = 0.0
    details: dict[str, list | dict] = {"messages": [], "dimension_scores": {}}

    # 1. Finance data intact
    finance_ok = False
    try:
        finance_conn = sqlite3.connect(FINANCE_DB_PATH)
        finance_ok = check_finance_data(finance_conn)
        finance_conn.close()
    except Exception:
        pass

    score += record_score(
        details,
        "finance_data_intact",
        finance_ok,
        "Corrupted March 2026 department records found in finance DB",
        "Finance DB missing corrupted March 2026 records",
    )

    # 2-4. Email checks
    if not os.path.exists(GWS_DB_PATH):
        details["messages"].append(
            f"ERROR: gws database not found at {GWS_DB_PATH}"
        )
        return score, details

    try:
        email_conn = sqlite3.connect(GWS_DB_PATH)

        # Get sent emails relevant to this task. The instruction tells the agent
        # "The email subject should clearly indicate it is a budget alert", so we
        # restrict to subjects mentioning 'budget' or 'alert' (case-insensitive)
        # to exclude unrelated baseline-seed emails in the sent folder.
        alert_emails = [
            (recipient, subject, body)
            for to, subject, body in sent_emails(email_conn)
            if "budget" in subject.lower() or "alert" in subject.lower()
            for recipient in to
        ]
        email_conn.close()

        # Build a map of recipient -> list of emails
        emails_by_recipient: dict[str, list[tuple[str, str, str]]] = {}
        for recipient, subject, body in alert_emails:
            emails_by_recipient.setdefault(recipient.lower(), []).append(
                (recipient, subject, body)
            )

        # Recipient set analysis: instruction forbids emails to non-violating
        # departments, so both dimensions reject ANY extra recipient beyond the
        # 3 violators.
        found_emails = set(emails_by_recipient.keys())
        expected_lower = {e.lower() for e in EXPECTED_RECIPIENTS}
        extras = found_emails - expected_lower
        missing = expected_lower - found_emails
        sent_count = len(found_emails & expected_lower)

        # 2. Email sent count: exactly 3 emails to violators AND no extras
        score += record_score(
            details,
            "email_sent_count",
            sent_count == 3 and len(extras) == 0,
            f"Alert emails sent to {sent_count}/3 violating managers with no extras",
            f"Alert emails sent to {sent_count}/3 violating managers; "
            f"{len(extras)} extra non-violator recipients: {sorted(extras)}",
        )

        # 3. Correct recipients: strict set equality with the 3 violating managers
        score += record_score(
            details,
            "correct_recipients",
            found_emails == expected_lower,
            f"Emails sent to exactly the correct managers: {sorted(found_emails)}",
            f"Recipient mismatch - missing: {sorted(missing)}, extras: {sorted(extras)}",
        )

        # 4. Email content: each email mentions department and violation
        content_ok = True
        content_details = []
        for dept_name, info in VIOLATING_DEPTS.items():
            email_list = emails_by_recipient.get(info["manager_email"].lower(), [])
            if not email_list:
                content_ok = False
                content_details.append(f"No email for {dept_name}")
                continue

            found_dept_mention = False
            found_violation_mention = False
            for _recipient, subject, body in email_list:
                combined = (subject + " " + body).lower()
                if dept_name.lower() in combined:
                    found_dept_mention = True
                if info["violation"] == "negative_expense":
                    if (
                        "negative" in combined
                        or "-5000" in combined
                        or "-5,000" in combined
                    ):
                        found_violation_mention = True
                elif info["violation"] == "over_budget":
                    if (
                        "over budget" in combined
                        or "exceed" in combined
                        or "180,000" in combined
                        or "200,000" in combined
                        or "180000" in combined
                        or "200000" in combined
                    ):
                        found_violation_mention = True

            if not found_dept_mention:
                content_ok = False
                content_details.append(f"Email to {dept_name} missing department name")
            elif not found_violation_mention:
                content_ok = False
                content_details.append(
                    f"Email to {dept_name} missing violation description"
                )
            else:
                content_details.append(f"Email to {dept_name} OK")

        score += record_score(
            details,
            "email_content",
            content_ok,
            f"All emails contain department name and violation description: {'; '.join(content_details)}",
            f"Some emails lack required content: {'; '.join(content_details)}",
        )

    except Exception as e:
        details["messages"].append(f"ERROR: {e}")
        details["messages"].append(traceback.format_exc())

    return score, details


if __name__ == "__main__":
    score, details = main()

    print(f"Score: {score:.2f}/1.0")
    for msg in details["messages"]:
        print(f"  {msg}")

    # Write reward.json breakdown
    try:
        reward_json = {"reward": round(score, 2)}
        reward_json.update(details["dimension_scores"])
        with open("/logs/verifier/reward.json", "w") as f:
            json.dump(reward_json, f, indent=2)
    except Exception:
        pass

    sys.exit(0 if score >= 0.5 else 1)
