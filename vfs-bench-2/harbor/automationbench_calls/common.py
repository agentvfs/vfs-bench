"""Calls every task's world answers alike: the tools themselves, and
``api_fetch``'s routing before a service's router (unknown URLs, the
service gate, bad JSON)."""

QUERIES = [
    "send slack message", "inbox messages", "trash", "send label", "create contact salesforce",
    "spreadsheet values append", "list files drive", "update opportunity stage", "", "!!!",
    "calendar event create attendees", "zoom meeting registrants", "jira issue transition",
    "hubspot deal pipeline", "docusign envelope recipients", "linkedin share post",
]

# A URL for each service, which a world not subscribed to it refuses (401).
GATED = {
    "xero": "https://api.xero.com/api.xro/2.0/Invoices",
    "wave": "https://gql.waveapps.com/graphql/public",
    "quickbooks": "https://quickbooks.api.intuit.com/v3/company/1/query",
    "twitter": "https://api.twitter.com/2/tweets",
    "instagram": "https://graph.facebook.com/v25.0/me",
    "facebook_pages": "https://graph.facebook.com/v25.0/123/feed",
    "facebook_conversions": "https://graph.facebook.com/v25.0/123/events",
    "facebook_lead_ads": "https://graph.facebook.com/v25.0/act_1/leads",
    "linkedin_ads": "https://api.linkedin.com/rest/adAccounts",
    "linkedin_conversions": "https://api.linkedin.com/rest/conversionEvents",
    "canva": "https://api.canva.com/rest/v1/designs",
    "buffer": "https://api.bufferapp.com/1/profiles.json",
    "pipefy": "https://api.pipefy.com/graphql/",
    "recruitee": "https://api.recruitee.com/c/1/candidates",
    "bamboohr": "https://api.bamboohr.com/api/gateway.php/acme/v1/employees/directory",
    "basecamp3": "https://3.basecampapi.com/1/projects.json",
    "reamaze": "https://acme.reamaze.io/api/v1/conversations",
    "confluence": "https://acme.atlassian.net/wiki/rest/api/content",
    "jira": "https://acme.atlassian.net/rest/api/3/search",
    "mailchimp": "https://us1.api.mailchimp.com/3.0/lists",
    "zendesk": "https://acme.zendesk.com/api/v2/tickets",
    "freshdesk": "https://acme.freshdesk.com/api/v2/tickets",
    "gorgias": "https://acme.gorgias.com/api/tickets",
    "chatgpt": "https://api.openai.com/v1/chat/completions",
    "hiver": "https://api2.hiverhq.com/v1/inboxes",
    "helpcrunch": "https://api.helpcrunch.com/v1/chats",
    "helpscout": "https://api.helpscout.net/v2/conversations",
    "intercom": "https://api.intercom.io/contacts",
    "zoho_desk": "https://desk.zoho.com/api/v1/tickets",
    "calendly": "https://api.calendly.com/users/me",
    "twilio": "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json",
    "monday": "https://api.monday.com/v2/",
    "trello": "https://api.trello.com/1/boards/1",
    "airtable": "https://api.airtable.com/v0/app1/tbl1",
    "asana": "https://app.asana.com/api/1.0/tasks",
    "notion": "https://api.notion.com/v1/search",
    "google_ads": "https://googleads.googleapis.com/v19/customers/1/googleAds:search",
    "linkedin": "https://api.linkedin.com/v2/me",
    "docusign": "https://demo.docusign.net/restapi/v2.1/accounts/1/envelopes",
    "zoom": "https://api.zoom.us/v2/users/me/meetings",
    "hubspot": "https://api.hubapi.com/crm/v3/objects/contacts",
    "google_calendar": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    "salesforce": "https://acme.my.salesforce.com/services/data/v61.0/query",
    "slack": "https://slack.com/api/conversations.list",
    "google_drive": "https://www.googleapis.com/drive/v3/files",
    "google_sheets": "https://sheets.googleapis.com/v4/spreadsheets/x",
    "gmail": "https://gmail.googleapis.com/gmail/v1/users/me/messages",
}

KNOWN = {}


def calls(world, last):
    for q in QUERIES:
        yield "api_search", {"query": q}
    yield "api_search", {"query": "messages", "top_k": 1}
    yield "api_search", {"query": "messages", "top_k": 12}
    yield "api_search", {"query": "messages", "top_k": 0}
    for text in ["hello", "To: a@b.c\r\nSubject: hi\r\n\r\nbody é ✓", "", "?>?>"]:
        yield "base64_encode", {"text": text}
    allowed = set(world["meta"].get("allowed_services") or [])
    for service, url in GATED.items():
        if service not in allowed:
            yield "api_fetch", {"method": "GET", "url": url}
    for url in ["https://example.org/x", "ftp://nowhere", "", "nothing/at/all", "https://api.unknown.io/v1/x"]:
        yield "api_fetch", {"method": "GET", "url": url}
    yield "api_fetch", {"method": "GET", "url": "https://example.org/x", "params": "{bad"}
    yield "api_fetch", {"method": "GET", "url": "https://example.org/x", "body": '{"a":}'}
    yield "api_fetch", {"method": "GET", "url": "https://example.org/x", "params": "{}", "body": ""}
    yield "api_fetch", {"method": "GET"}
    yield "api_fetch", {"method": "GET", "url": "https://example.org/x", "extra": 1}
    yield "api_search", {}
