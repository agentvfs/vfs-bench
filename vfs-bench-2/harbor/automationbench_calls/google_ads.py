"""Google Ads calls: every route of tools/api/routes/google_ads.py: GAQL
searches (valid and invalid, paging), campaign gets and mutations,
offline user data jobs, member removal and conversion uploads, with the
task's seeded campaigns and lists, and error cases.

A customer list's ``members`` is a Python set, whose order upstream
iterates by string hash, randomized per process: these calls never hold
two members in one list at once, so the dumped order is comparable."""
import json

KNOWN = {}

BASE = "https://googleads.googleapis.com/v19/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


QUERIES = [
    "SELECT campaign.id, campaign.name, campaign.status FROM campaign",
    "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED'",
    "SELECT campaign.name, metrics.ctr, metrics.clicks FROM campaign ORDER BY metrics.ctr DESC LIMIT 3",
    "SELECT campaign.name, metrics.impressions FROM campaign WHERE metrics.impressions > 1000 ORDER BY campaign.name",
    "SELECT campaign.name, campaign.spend FROM campaign WHERE campaign.spend >= 500.5 AND campaign.status != 'PAUSED'",
    "SELECT campaign.name FROM campaign WHERE campaign.name LIKE '%Brand%'",
    "SELECT campaign.name FROM campaign WHERE campaign.name NOT LIKE '%Test%' ORDER BY campaign.id DESC",
    "SELECT campaign.name FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED') LIMIT 2",
    "SELECT campaign.name FROM campaign WHERE campaign.status NOT IN ('REMOVED')",
    "SELECT campaign.name FROM campaign WHERE campaign.name REGEXP_MATCH '.*Display.*'",
    "SELECT campaign.name FROM campaign WHERE campaign.name CONTAINS ANY ('Brand')",
    "SELECT campaign.name, campaign.start_date FROM campaign WHERE segments.date DURING LAST_30_DAYS",
    "SELECT campaign.name FROM campaign WHERE campaign.start_date BETWEEN '2026-01-01' AND '2026-12-31'",
    "SELECT campaign.name FROM campaign WHERE campaign.notes IS NULL",
    "SELECT campaign.name FROM campaign WHERE campaign.notes IS NOT NULL",
    "SELECT campaign.daily_budget, campaign.spent_this_month, campaign.days_remaining FROM campaign",
    "SELECT campaign.name, campaign.advertising_channel_type, campaign.resource_name FROM campaign",
    "SELECT campaign.name, customer.id, metrics.cost_micros FROM campaign",
    "select campaign.name from campaign where campaign.status = 'ENABLED' order by campaign.name asc limit 5",
    "SELECT user_list.id, user_list.name, user_list.size_for_search FROM user_list",
    "SELECT user_list.name, user_list.membership_life_span FROM user_list WHERE user_list.name = 'High Intent'",
    "SELECT user_list.name FROM campaign",
    "SELECT campaign.name FROM user_list",
    "SELECT * FROM campaign",
    "SELECT campaign.name FROM campaign WHERE campaign.status = 'ENABLED' OR campaign.status = 'PAUSED'",
    "SELECT campaign.name FROM campaign WHERE NOT campaign.status = 'ENABLED'",
    "SELECT campaign.name FROM campaign LIMIT 5 OFFSET 2",
    "SELECT campaign.name FROM ad_group",
    "SELECT campaign.name FROM campaign PARAMETERS include_drafts=true",
    "SELECT FROM campaign",
    "SELECT campaign.name campaign",
    "SELECT campaign.name FROM campaign WHERE campaign.name = 'unterminated",
    "SELECT campaign.name FROM campaign WHERE campaign.clicks > 'abc'",
    "",
    "SELECT campaign.name FROM campaign LIMIT 0",
    "SELECT name FROM campaign",
]


def calls(world, last):
    state = world["google_ads"]
    campaigns = state.get("campaigns", [])
    lists = state.get("customer_lists", [])
    accounts = sorted({c.get("account_id") for c in campaigns + lists if c.get("account_id")}) or ["acct_none"]
    cust = accounts[0]
    for q in QUERIES:
        yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": q})
    yield fetch("POST", "customers/other/googleAds:search", body={"query": QUERIES[0]})
    yield fetch("POST", "customers/-/googleAds:search", body={"query": QUERIES[0]})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0] + " LIMIT 4"})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0] + " LIMIT 4", "pageToken": "2"})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": "3"})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": 1})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": "-1"})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": "abc"})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": [1]})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": 2.7})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageToken": " 1 "})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "pageSize": 10})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": 5})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": None})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"customerId": "dup"})
    yield fetch("POST", f"customers/{cust}/googleAds:search", body="[1]")
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0], "extra": True})
    for c in campaigns[:3]:
        yield fetch("GET", f"customers/{c.get('account_id')}/campaigns/{c['id']}")
    if campaigns:
        c = campaigns[0]
        yield fetch("GET", f"customers/wrong/campaigns/{c['id']}")
        yield fetch("POST", f"customers/{c.get('account_id')}/campaigns:mutate", body={"operations": [
            {"update": {"id": c["id"], "status": "PAUSED"}, "updateMask": "status"}]})
        yield fetch("GET", f"customers/{c.get('account_id')}/campaigns/{c['id']}")
    if len(campaigns) > 2:
        c1, c2 = campaigns[1], campaigns[2]
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": [
            {"update": {"resourceName": f"customers/{cust}/campaigns/{c1['id']}"}, "status": "PAUSED"},
            {"update": {"resource_name": f"customers/{cust}/campaigns/{c2['id']}", "name": "Renamed"}},
            {"remove": f"customers/{cust}/campaigns/{c2['id']}"},
            "not a dict",
            {"update": {"id": "nope", "status": "PAUSED"}},
            {"remove": "customers/x/campaigns/missing"},
            {"remove": 5},
        ]})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": [{"update": {"id": c1["id"], "status": "BOGUS"}}]})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": [{"update": {"id": c1["id"], "name": 7}}]})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": [{"update": {"resource_name": None}}]})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": [{"update": {"id": c1["id"]}, "status": ""}]})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"campaign_id": c1["id"], "status": "ENABLED"})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"campaign_name": c2["name"].upper(), "status": "PAUSED"})
        yield fetch("POST", "customers/null/campaigns:mutate", body={"campaign_id": c1["id"], "status": "REMOVED"})
        yield fetch("POST", "customers/default/campaigns:mutate", body={"campaign_id": c1["id"]})
        yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"campaign_id": c1["id"], "status": "nope"})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"campaign_id": "missing"})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"campaign_name": 5})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": []})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"operations": "x", "campaign_id": "missing"})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"mainAccountId": "dup"})
    yield fetch("POST", f"customers/{cust}/campaigns:mutate", body={"partialFailure": True, "validateOnly": False, "extra": 1})
    yield fetch("GET", f"customers/{cust}/campaigns/missing")
    # Offline user data jobs: at most one member in a list at a time.
    lid = lists[0]["id"] if lists else "list_none"
    lname = lists[0]["name"] if lists else "none"
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs:create", body={"job": {
        "type": "CUSTOMER_MATCH_USER_LIST", "customerMatchUserListMetadata": {"userList": f"customers/{cust}/userLists/{lid}"}}})
    job = last()
    job_id = job.get("resourceName", "x/0").split("/")[-1] if isinstance(job, dict) else "0"
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": [
        {"create": {"userIdentifiers": [{"hashedEmail": "Alice@Example.com"}, {"phone": "1"}, {"hashedEmail": ""}]}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": [
        {"create": {"userIdentifiers": [{"hashedEmail": "alice@example.com"}]}}, "x"], "enablePartialFailure": True})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": [
        {"remove": {"userIdentifiers": [{"hashedEmail": "ALICE@example.com"}, {"hashedEmail": "nobody@x.com"}]}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": [
        {"create": {"userIdentifiers": "ab"}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": [
        {"create": {"userIdentifiers": 5}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": [
        {"create": {"userIdentifiers": [{"hashedEmail": 5}]}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"operations": "x"})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:addOperations", body={"jobId": "dup"})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:run", body={})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{job_id}:run", body={"extra": 1})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/999:run", body={})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/999:addOperations", body={"operations": []})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs:create", body={"job": {"customerMatchUserListMetadata": {"userList": 5}}})
    bad = last()
    bad_id = bad.get("resourceName", "x/0").split("/")[-1] if isinstance(bad, dict) else "0"
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{bad_id}:addOperations", body={"operations": []})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs:create", body={"job": {"customerMatchUserListMetadata": "x"}})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs:create", body={"job": "x"})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs:create", body={})
    plain = last()
    plain_id = plain.get("resourceName", "x/0").split("/")[-1] if isinstance(plain, dict) else "0"
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs/{plain_id}:addOperations", body={"operations": [
        {"create": {"userIdentifiers": [{"hashedEmail": "z@z.com"}]}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs:create", body={"customerId": "dup"})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body={"userListId": lid, "operations": [
        {"create": {"userIdentifiers": [{"hashedEmail": "Bob@Example.com"}]}}]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body={"userListId": lname.lower(), "operations": [
        {"remove": {"userIdentifiers": [{"hashedEmail": "bob@example.com"}]}}, 3]})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body={"userListId": "missing"})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body={"userListId": 12})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body={})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body={"userListId": lid, "operations": "x"})
    yield fetch("POST", f"customers/{cust}/offlineUserDataJobs", body="[1]")
    yield fetch("POST", f"customers/{cust}/userLists/{lid}:removeMembers", body={"email": "Carol@x.com"})
    yield fetch("POST", f"customers/{cust}/userLists/{lid}:removeMembers", body={"customer_identifier": "Dan@x.com"})
    yield fetch("POST", f"customers/{cust}/userLists/{lid}:removeMembers", body={})
    yield fetch("POST", f"customers/{cust}/userLists/{lid}:removeMembers", body={"email": 5})
    yield fetch("POST", f"customers/{cust}/userLists/missing:removeMembers", body={"email": "a@b.c"})
    yield fetch("POST", f"customers/{cust}/userLists/{lid}:removeMembers", body={"listId": "dup"})
    # Conversions.
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"conversions": [
        {"gclid": "gclid_1", "conversionAction": "customers/1/conversionActions/9", "conversionDateTime": "2026-02-01T10:00:00Z",
         "conversionValue": 150.0, "currencyCode": "EUR"},
        {"conversionAction": "Signup", "conversionDateTime": "2026-02-02 09:30:00"},
        {"gclid": "g3", "conversionAction": "Lead", "conversionDateTime": "2026-02-03T08:00:00+05:30", "conversionValue": 0},
        {"gclid": "g4", "conversionAction": "Bad date", "conversionDateTime": "yesterday", "conversionValue": "12"},
        {"gclid": "g5", "conversionAction": "No date", "conversionDateTime": 5},
        "skip me",
    ], "partialFailure": True})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"conversions": [{"conversionAction": 5}]})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"conversions": []})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"name": "Purchase", "time": "2026-02-05T12:00:00Z", "gclid": "gc", "value": "99.99", "currency": "USD"})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"name": "Lead", "email": "a@b.c"})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"name": "Call", "phone": "+1555", "time": "bad"})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"name": "Typed", "time": 5})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"name": 5})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"value": 3})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body={"mainAccountId": "dup"})
    yield fetch("POST", f"customers/{cust}:uploadClickConversions", body="[]")
    yield fetch("POST", f"customers/{cust}/googleAds:search", body={"query": QUERIES[0]})
    yield fetch("GET", f"customers/{cust}/googleAds:search")
    yield fetch("POST", f"customers/{cust}/campaigns/x")
    yield fetch("POST", "googleads/v19/customers/1/googleAds:search", body={"query": QUERIES[0]}, base="")
