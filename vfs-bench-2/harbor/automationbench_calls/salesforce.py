"""Salesforce's calls: every route of routes/salesforce.py, SOQL over the
query engine's grammar and semantics, writes that later reads see, and the
errors upstream returns or raises."""
import json

BASE = "https://acme.my.salesforce.com/services/data/v61.0/"
OLD = "https://acme.my.salesforce.com/v61.0/"

KNOWN = {}


def calls(world, last):
    sf = world["salesforce"]

    def first_id(name, n=0):
        items = sf.get(name) or []
        return items[n]["id"] if len(items) > n else "missing000000000"

    def get(path, params=None, base=BASE):
        args = {"method": "GET", "url": base + path}
        if params is not None:
            args["params"] = json.dumps(params)
        return "api_fetch", args

    def send(method, path, body=None, base=BASE, raw=None):
        args = {"method": method, "url": base + path}
        if raw is not None:
            args["body"] = raw
        elif body is not None:
            args["body"] = json.dumps(body)
        return "api_fetch", args

    def soql(q):
        return get("query", {"q": q})

    contact, account, lead, opp = first_id("contacts"), first_id(
        "accounts"), first_id("leads"), first_id("opportunities")
    campaign, case, user = first_id("campaigns"), first_id("cases"), first_id(
        "users")

    # Reads: SOQL across every object, the grammar and its errors.
    for obj in [
            "Contact", "Account", "Lead", "Opportunity", "Campaign", "Case",
            "Task", "Event", "Note", "Attachment", "Document", "Folder",
            "CampaignMember", "CaseComment", "User", "contact", "Contract"
    ]:
        yield soql(f"SELECT Id, Name FROM {obj}")
    for q in [
            "SELECT * FROM Contact",
            "SELECT Id, FirstName, LastName, Email, AccountId, Account.Name, "
            "Owner.Name FROM Contact ORDER BY LastName",
            "SELECT Id, Name, Amount, StageName, CloseDate FROM Opportunity "
            "WHERE Amount > 50000 ORDER BY Amount DESC",
            "SELECT Id, Name, Amount FROM Opportunity WHERE Amount >= 10000 "
            "AND (StageName = 'Closed Won' OR StageName != 'Prospecting') "
            "ORDER BY CloseDate DESC, Name LIMIT 3",
            "SELECT Id, Name FROM Opportunity WHERE CloseDate = THIS_MONTH",
            "SELECT Id, Name FROM Opportunity WHERE CloseDate = THIS_QUARTER "
            "OR CloseDate = LAST_QUARTER",
            "SELECT Id, Name FROM Opportunity WHERE CloseDate < 2026-06-01 "
            "ORDER BY CloseDate",
            "SELECT Id, Name FROM Opportunity WHERE CloseDate > TODAY",
            "SELECT Id, Name FROM Opportunity WHERE CloseDate = "
            "NEXT_N_DAYS:90",
            "SELECT Id FROM Contact WHERE CreatedDate = LAST_N_DAYS:30",
            "SELECT Id FROM Contact WHERE CreatedDate = THIS_YEAR",
            "SELECT Id FROM Contact WHERE CreatedDate >= CURRENT_DATE",
            "SELECT Id, Name, Email FROM Contact WHERE Email LIKE '%@%' ORDER "
            "BY Email DESC LIMIT 5 OFFSET 1",
            "SELECT Id, Name FROM Contact WHERE Name LIKE 'a%'",
            "SELECT Id, Name FROM Contact WHERE NOT Name LIKE '%e%'",
            "SELECT Id, Name FROM Contact WHERE Name NOT LIKE '_a%'",
            "SELECT Id, Name, Industry FROM Account WHERE Industry IN "
            "('Technology', 'Healthcare', 'Finance')",
            "SELECT Id, Name, Industry FROM Account WHERE Industry NOT IN "
            "('Technology')",
            "SELECT Id, Name FROM Account WHERE Industry = null",
            "SELECT Id, Name FROM Account WHERE Industry != NULL ORDER BY "
            "Industry, Name DESC",
            "SELECT Id, Name, AnnualRevenue FROM Account WHERE AnnualRevenue "
            "> 1e6 ORDER BY AnnualRevenue",
            "SELECT Id, Name, AnnualRevenue FROM Account ORDER BY "
            "AnnualRevenue DESC",
            "SELECT Id, Name, Parent.Name, Account.Parent.Name FROM Account",
            "SELECT Id, Name, IsWon, IsClosed FROM Opportunity WHERE IsWon = "
            "true",
            "SELECT Id, Name FROM Opportunity WHERE IsClosed = FALSE",
            "SELECT Id, Name FROM Lead WHERE Status = 'Open - Not Contacted' "
            "OR Status = 'open'",
            "SELECT Id, Name, LeadSource, Company FROM Lead WHERE Company "
            "LIKE '%Inc%' ORDER BY Company",
            "SELECT Id, Name FROM Lead WHERE (Status = 'New' AND Rating = "
            "'Hot') OR NOT (Industry = 'Retail')",
            "SELECT COUNT() FROM Contact",
            "SELECT COUNT(Id) FROM Opportunity WHERE Amount > 0",
            "SELECT COUNT(*) FROM Lead",
            "SELECT FIELDS(ALL) FROM Account LIMIT 2",
            "SELECT FIELDS(STANDARD) FROM Opportunity LIMIT 1",
            "SELECT FIELDS(CUSTOM) FROM Opportunity LIMIT 1",
            "SELECT FIELDS(ALL) FROM Account",
            "SELECT Id, Subject, Status, Priority FROM Case ORDER BY "
            "Priority, Subject",
            "SELECT Id, Subject FROM Task WHERE Status != 'Completed' ORDER "
            "BY ActivityDate",
            "SELECT Id, Name, Email, IsActive FROM User WHERE IsActive = true",
            "SELECT Id FROM Contact LIMIT 1;",
            "SELECT Id FROM Contact ALL ROWS",
            "select id, name from contact where name != '' order by name asc "
            "limit 2",
            "SELECT Id, Name FROM Contact WHERE Name = 'O''Brien' OR Name = "
            "\"x\\\"y\"",
            "SELECT Id FROM Contact WHERE Id IN ()",
            "SELECT Id, Amount FROM Opportunity WHERE Amount = 50000.00",
            "SELECT Id, Amount FROM Opportunity WHERE Amount < '100'",
            "SELECT Id FROM Opportunity WHERE Probability >= 50 AND "
            "Probability <= 90",
            "SELECT Id FROM Opportunity ORDER BY Probability DESC, Amount",
            "SELEC Id FROM Contact",
            "SELECT FROM Contact",
            "SELECT Id FROM",
            "SELECT Id FROM Widget",
            "SELECT Id FROM Contact WHERE Name = 'unterminated",
            "SELECT Id FROM Contact WHERE Amount BETWEEN 1 AND 2",
            "SELECT Id FROM Contact WHERE Name DURING TODAY",
            "SELECT Id FROM Contact WHERE Id IN (SELECT ContactId FROM Case)",
            "SELECT Id FROM Contact LIMIT 0",
            "SELECT Id FROM Contact LIMIT -1",
            "SELECT Id FROM Contact LIMIT 2.5",
            "SELECT Id FROM Contact OFFSET 1 LIMIT 1",
            "SELECT Id FROM Contact STARTPOSITION 1",
            "SELECT Id FROM Contact WHERE Name ~ 'x'",
            "SELECT Id FROM Contact WHERE Name NOT = 'x'",
            "SELECT Id FROM Contact WHERE Name <> 'x'",
            "SELECT Id FROM Contact GROUP BY Name",
            "SELECT Id FROM Contact WHERE",
            "SELECT Id, FIELDS(BOGUS) FROM Contact",
            "   ",
    ]:
        yield soql(q)
    # Queries keyed on the seeded records' own values.
    for c in (sf.get("contacts") or [])[:3]:
        name = " ".join(x for x in [c.get("first_name"),
                                    c.get("last_name")] if x)
        yield soql("SELECT Id, Name, Email, AccountId, Account.Name, "
                   f"Account.Industry FROM Contact WHERE Name = '{name}'")
        if c.get("email"):
            yield soql("SELECT Id, Name FROM Contact WHERE Email = "
                       f"'{c['email'].upper()}'")
            yield get("sobjects/Contact/find", {
                "searchField": "Email",
                "searchValue": c["email"]
            },
                      base=OLD)
        if c.get("account_id"):
            yield soql("SELECT Id, Name, Title FROM Contact WHERE AccountId = "
                       f"'{c['account_id']}' ORDER BY Title DESC")
        yield get("sobjects/Contact/find", {
            "searchField": "Name",
            "searchValue": name,
            "searchResults": "all"
        },
                  base=OLD)
    for a in (sf.get("accounts") or [])[:3]:
        yield soql(
            "SELECT Id, Name, Industry, AnnualRevenue FROM Account WHERE "
            f"Name LIKE '%{(a.get('account_name') or 'x')[:4]}%'")
        yield get("sobjects/Account/find", {
            "searchField": "Name",
            "searchValue": a.get("account_name")
        },
                  base=OLD)
    for o in (sf.get("opportunities") or [])[:3]:
        yield soql(
            "SELECT Id, Name, Amount, StageName FROM Opportunity WHERE "
            f"StageName = '{o.get('stage_name')}' AND Amount != null ORDER BY "
            "Amount")
        if o.get("close_date"):
            yield soql("SELECT Id, Name FROM Opportunity WHERE CloseDate <= "
                       f"{o['close_date'][:10]} ORDER BY CloseDate DESC")
            yield soql("SELECT Id, Name FROM Opportunity WHERE CloseDate = "
                       f"'{o['close_date']}'")
    ids = [c["id"] for c in (sf.get("contacts") or [])[:4]]
    if ids:
        yield soql("SELECT Id, Name FROM Contact WHERE Id IN (" +
                   ", ".join(f"'{i}'" for i in ids) + ")")
        yield soql("SELECT Id, Name FROM Contact WHERE Id NOT IN (" +
                   ", ".join(f"'{i}'" for i in ids) + ") LIMIT 5")
    for lead_row in (sf.get("leads") or [])[:2]:
        yield soql(
            "SELECT Id, Name, Status, LeadScore FROM Lead WHERE Company = "
            f"'{lead_row.get('company')}' OR LeadScore > 50")
    for u in (sf.get("users") or [])[:2]:
        yield soql(
            "SELECT Id, Name, Owner.Name, Owner.Email FROM Opportunity WHERE "
            f"OwnerId = '{u['id']}'")
        yield get(f"sobjects/User/{u['id']}")
    for obj in [
            "Contact", "Account", "Lead", "Opportunity", "Case", "User",
            "Campaign"
    ]:
        yield soql(
            f"SELECT FIELDS(ALL) FROM {obj} ORDER BY CreatedDate DESC, Id "
            "LIMIT 200")
        yield soql(
            f"SELECT FIELDS(STANDARD) FROM {obj} ORDER BY LastModifiedDate, "
            "Name DESC")
    for coll, obj in [("contacts", "Contact"), ("accounts", "Account"),
                      ("leads", "Lead"), ("opportunities", "Opportunity"),
                      ("cases", "Case"), ("users", "User"),
                      ("campaigns", "Campaign"), ("tasks", "Task"),
                      ("events", "Event")]:
        for rec in (sf.get(coll) or [])[:2]:
            yield get(f"sobjects/{obj}/{rec['id']}")
    yield get("query", {})
    yield get("query", {"q": 5})
    yield get("query", {"object_type": "Account"})
    yield get("query", {"object_type": "Account", "where": "Name LIKE '%a%'"})
    yield get("query", {"q": "SELECT Id FROM Account", "extra": 1})
    yield get("query", None, base=OLD)
    yield get("query", {"q": "SELECT Id, Name FROM Lead LIMIT 2"}, base=OLD)
    yield "api_fetch", {
        "method": "GET",
        "url": BASE + "query",
        "params": "[1]"
    }

    # SOSL.
    for q in [
            "FIND {a}", "FIND {Inc} IN ALL FIELDS", "find{TECH}", "acme",
            "SELECT Id FROM Contact", "", "  select x"
    ]:
        yield get("search", {"q": q})
    yield get("search", {"q": 5})
    yield get("search", {})

    # Gets, finds.
    for obj, rid in [("Contact", contact), ("Account", account),
                     ("Lead", lead), ("Opportunity", opp),
                     ("Campaign", campaign), ("Case", case), ("User", user),
                     ("Contact", "nope"), ("Widget", "x"),
                     ("contact", contact), ("Task", first_id("tasks")),
                     ("Event", first_id("events"))]:
        yield get(f"sobjects/{obj}/{rid}")
        yield get(f"sobjects/{obj}/{rid}", base=OLD)
    for obj, field, value in [("Contact", "Name", "a"),
                              ("Contact", "Email", "@"),
                              ("Contact", "LastName", "x"),
                              ("Account", "Name", "inc"),
                              ("Account", "Industry", "Technology"),
                              ("Opportunity", "StageName", "Closed Won"),
                              ("Opportunity", "Amount", 50000),
                              ("Lead", "Company", "a"), ("Lead", "Name", "j"),
                              ("Campaign", "Name", "a"),
                              ("Case", "Status", "New"),
                              ("Task", "Subject", "a"),
                              ("Event", "Subject", "a"),
                              ("Contact", "AccountId", account),
                              ("Contact", "account_id", account),
                              ("Contact", "Id", contact),
                              ("Contact", "to_display_dict", "x"),
                              ("Opportunity", "IsWon", True),
                              ("Contact", "Nothing", "x")]:
        path = {
            "Contact": "sobjects/Contact/find",
            "Lead": "sobjects/Lead/find",
            "Account": "sobjects/Account/find",
            "Opportunity": "sobjects/Opportunity/find",
            "Campaign": "sobjects/Campaign/find",
            "Case": "sobjects/Case/find",
            "Task": "sobjects/Task/find",
            "Event": "sobjects/Event/find"
        }[obj]
        yield get(path, {"searchField": field, "searchValue": value}, base=OLD)
        yield get(path, {
            "searchField": field,
            "searchValue": value,
            "searchResults": "all"
        },
                  base=OLD)
    yield get("sobjects/User/IsActive/find", {"searchValue": "active"},
              base=OLD)
    yield get("sobjects/User/x/find", {
        "searchField": "IsActive",
        "searchValue": "inactive",
        "searchResults": "all"
    },
              base=OLD)
    yield get("sobjects/User/x/find", {
        "searchField": "Status",
        "searchValue": True
    },
              base=OLD)
    yield get("sobjects/Widget/x/find", {"searchField": "Name"}, base=OLD)
    yield get("sobjects/Contact/find", {
        "searchField": 5,
        "searchValue": "x"
    },
              base=OLD)
    yield get("sobjects/Contact/find", {"searchField": ["Name"]}, base=OLD)
    yield get("sobjects/Contact/find", {"object": "Lead"}, base=OLD)
    yield get("sobjects/Contact/find", {}, base=OLD)

    # Creates.
    yield send(
        "POST", "sobjects/Contact", {
            "FirstName": "Ada",
            "LastName": "Lovelace",
            "Email": "ada@example.com",
            "AccountId": account,
            "Title": "CTO",
            "MailingCity": "London"
        })
    new_contact = last().get("id") if isinstance(last(), dict) else None
    yield send("POST", "sobjects/Contact", {
        "last_name": "Snake",
        "email": "s@x.io",
        "phone": "1",
        "Department": "x"
    })
    yield send("POST", "sobjects/Contact", {"LastName": 5})
    yield send("POST", "sobjects/Contact", {})
    yield send("POST", "sobjects/Contact", raw="[1]")
    yield send("POST", "sobjects/Contact", {"world": 1})
    yield send("POST", "sobjects/Contact", {"LastName": "Old"}, base=OLD)
    yield send(
        "POST", "sobjects/Lead", {
            "LastName": "Hopper",
            "Company": "Navy",
            "Status": "Working",
            "LeadSource": "Web",
            "Email": "grace@navy.mil",
            "City": "Arlington"
        })
    new_lead = last().get("id") if isinstance(last(), dict) else None
    yield send("POST", "sobjects/Lead", {
        "last_name": "Plain",
        "company": "Co",
        "source": "x"
    })
    yield send("POST", "sobjects/Lead", {"LastName": "NoStatus"}, base=OLD)
    yield send("POST", "sobjects/Lead", {"LastName": "Bad", "Company": ["x"]})
    yield send(
        "POST", "sobjects/Account", {
            "Name": "Globex",
            "Type": "Customer",
            "Industry": "Energy",
            "NumberOfEmployees": 250,
            "AnnualRevenue": 1250000,
            "BillingCountry": "US"
        })
    new_account = last().get("id") if isinstance(last(), dict) else None
    yield send(
        "POST", "sobjects/Account", {
            "account_name": "Initech",
            "annual_revenue": 1.5,
            "number_of_employees": "12"
        })
    yield send("POST", "sobjects/Account", {
        "Name": "Bad",
        "NumberOfEmployees": "many"
    })
    yield send("POST", "sobjects/Account", {
        "Name": "Zero",
        "NumberOfEmployees": 0,
        "number_of_employees": 7
    })
    yield send(
        "POST", "sobjects/Opportunity", {
            "Name": "Globex Deal",
            "StageName": "Prospecting",
            "CloseDate": "2026-06-30",
            "AccountId": new_account,
            "Amount": "75000",
            "Probability": "20"
        })
    new_opp = last().get("id") if isinstance(last(), dict) else None
    yield send(
        "POST", "sobjects/Opportunity", {
            "Name": "Z",
            "CloseDate": "2026-06-30T10:00:00Z",
            "Amount": 12.5,
            "Probability": 30.9
        })
    yield send("POST", "sobjects/Opportunity", {
        "Name": "Basic",
        "CloseDate": 20260701
    })
    yield send("POST", "sobjects/Opportunity", {
        "Name": "Bad date",
        "CloseDate": "June 30"
    })
    yield send("POST", "sobjects/Opportunity", {
        "Name": "Bad amount",
        "Amount": "$5,000"
    })
    yield send("POST", "sobjects/Opportunity", {
        "Name": "Bad prob",
        "Probability": "50.5"
    })
    yield send("POST", "sobjects/Opportunity", {
        "Name": "List amount",
        "Amount": [1]
    })
    yield send("POST", "sobjects/Opportunity", {"Name": 7})
    yield send(
        "POST", "sobjects/Campaign", {
            "Name": "Spring Launch",
            "Type": "Webinar",
            "Status": "Active",
            "StartDate": "2026-04-01",
            "EndDate": "bad",
            "BudgetedCost": "5000",
            "IsActive": "yes"
        })
    new_campaign = last().get("id") if isinstance(last(), dict) else None
    yield send("POST", "sobjects/Campaign", {
        "campaign_name": "C2",
        "expected_revenue": 10
    })
    yield send("POST", "sobjects/Campaign", {
        "Name": "C3",
        "IsActive": "maybe"
    })
    yield send(
        "POST", "sobjects/Case", {
            "Subject": "Broken",
            "Description": "It broke",
            "Priority": "High",
            "AccountId": account,
            "ContactId": contact,
            "Origin": "Email"
        })
    new_case = last().get("id") if isinstance(last(), dict) else None
    yield send("POST", "sobjects/Case", {})
    yield send("POST", "sobjects/Case", {"Status": 3})
    yield send("POST", f"sobjects/Case/{new_case}/CaseComment",
               {"CommentBody": "Looking into it"})
    yield send("POST", "sobjects/CaseComment", {
        "ParentId": new_case,
        "CommentBody": "Fixed"
    })
    yield send("POST", "sobjects/CaseComment", {
        "ParentId": "nope",
        "CommentBody": "x"
    })
    yield send("POST", f"sobjects/Case/{new_case}/CaseComment",
               {"CommentBody": 5})
    yield send("POST", f"sobjects/Case/{new_case}/CaseComment",
               {"parent_id": "x"})
    yield send("POST",
               f"sobjects/Case/{case}/CaseComment", {"CommentBody": "legacy"},
               base=OLD)
    yield send(
        "POST", "sobjects/Task", {
            "Subject": "Follow up",
            "ActivityDate": "2026-05-01",
            "WhoId": new_contact,
            "WhatId": new_opp,
            "OwnerId": user,
            "Priority": "High"
        })
    yield send("POST", "sobjects/Task", {
        "subject": "Call",
        "due_date": "nope",
        "contact_id": contact
    })
    yield send("POST", "sobjects/Task", {})
    yield send(
        "POST", "sobjects/Event", {
            "Subject": "Kickoff",
            "StartDateTime": "2026-05-02T15:00:00Z",
            "EndDateTime": "2026-05-02T16:00:00+02:00",
            "WhoId": contact,
            "IsAllDayEvent": "false",
            "Location": "Zoom"
        })
    yield send("POST", "sobjects/Event", {"Subject": "Now"})
    yield send("POST", "sobjects/Event", {
        "Subject": "All day",
        "StartDateTime": "2026-05-03",
        "IsAllDayEvent": 1
    })
    yield send("POST", "sobjects/Note", {
        "ParentId": new_contact,
        "Title": "Met",
        "Body": "Notes",
        "IsPrivate": 0
    })
    yield send("POST", "sobjects/Note", {"parent_id": account})
    yield send("POST", "sobjects/Note", {})
    yield send(
        "POST", "sobjects/Attachment", {
            "ParentId": new_case,
            "Name": "log.txt",
            "Body": "aGVsbG8=",
            "IsPrivate": True
        })
    yield send("POST", "sobjects/Attachment", {})
    yield send("POST", "sobjects/Document", {
        "FolderId": "00l1",
        "Name": "Deck",
        "Body": "x",
        "Keywords": "k"
    })
    yield send("POST", "sobjects/Document", {"File": 5})
    yield send("POST", "sobjects/ContentVersion", {"Title": "x"})
    yield send("POST", "sobjects/ContentDocumentLink", {})
    yield send("POST", "sobjects/ContentNote", {"Title": "n"})
    yield send("POST", "sobjects/ContentNote", {}, base=OLD)
    yield send("POST", "actions/custom/flow/Escalate_Case",
               {"inputs": [{
                   "caseId": new_case
               }]})
    yield send("POST", "actions/custom/flow/Empty")
    yield get("analytics/reports/00O123", {"includeDetails": "true"})
    yield get("analytics/reports/00O123")
    yield get("analytics/reports/00O9", {"includeDetails": True}, base=OLD)

    # Email.
    yield send(
        "POST", "actions/standard/emailSimple", {
            "inputs": [{
                "emailAddresses": "a@b.c",
                "emailSubject": "Hi",
                "emailBody": "Body",
                "senderType": "OrgWideEmailAddress"
            }, {
                "emailAddresses": "d@e.f",
                "emailSubject": "Two",
                "relatedToId": contact
            }]
        })
    yield send("POST", "actions/standard/emailSimple", {
        "emailAddresses": "x@y.z",
        "emailSubject": "Flat"
    })
    yield send("POST", "actions/standard/emailSimple", {
        "toAddresses": ["x@y.z"],
        "emailSubject": "List"
    })
    yield send("POST", "actions/standard/emailSimple",
               {"inputs": ["notadict"]})
    yield send("POST", "actions/standard/emailSimple", {"inputs": []})
    yield send("POST",
               "email/send", {
                   "emailAddresses": "old@x.y",
                   "emailSubject": "Legacy",
                   "emailBody": "b"
               },
               base=OLD)

    # Campaign members.
    yield send(
        "POST", "sobjects/CampaignMember", {
            "CampaignId": new_campaign,
            "ContactId": new_contact,
            "Status": "Responded"
        })
    yield send("POST", "sobjects/CampaignMember", {
        "CampaignId": new_campaign,
        "ContactId": new_contact
    })
    yield send("POST", "sobjects/CampaignMember", {
        "campaign_id": new_campaign,
        "lead_id": new_lead
    })
    yield send("POST", "sobjects/CampaignMember", {
        "CampaignId": "nope",
        "LeadId": new_lead
    })
    yield send("POST", "sobjects/CampaignMember", {
        "CampaignId": new_campaign,
        "LeadId": "nope"
    })
    yield send("POST", "sobjects/CampaignMember", {"CampaignId": new_campaign})
    yield send("POST",
               "sobjects/CampaignMember/contact", {
                   "CampaignId": campaign,
                   "ContactId": contact
               },
               base=OLD)
    yield send("POST",
               "sobjects/CampaignMember/lead", {
                   "CampaignId": campaign,
                   "LeadId": lead,
                   "Status": "Sent"
               },
               base=OLD)
    yield send("POST",
               "sobjects/CampaignMember/lead", {
                   "CampaignId": campaign,
                   "LeadId": lead
               },
               base=OLD)
    yield send("POST", "sobjects/CampaignMember/lead", {"Bogus": 1}, base=OLD)
    yield soql(
        "SELECT Id, CampaignId, ContactId, LeadId, Status FROM CampaignMember")

    # Updates.
    yield send(
        "PATCH", f"sobjects/Contact/{new_contact}", {
            "Title": "CEO",
            "AccountId": account,
            "NdaStatus": "Signed",
            "Status": "Active",
            "MobilePhone": "555"
        })
    yield send("PATCH", f"sobjects/Contact/{contact}", {
        "email": "renamed@example.com",
        "Description": None
    })
    yield send("PATCH", f"sobjects/Contact/{contact}", {"AccountId": "nope"})
    yield send("PATCH", "sobjects/Contact/nope", {"Title": "x"})
    yield send("PATCH", f"sobjects/Contact/{contact}", {"Title": 5})
    yield send("PATCH", f"sobjects/Contact/{contact}", {"record_id": "x"})
    yield send("PATCH",
               f"sobjects/Contact/{contact}", {"Phone": "1"},
               base=OLD)
    yield send(
        "PATCH", f"sobjects/Lead/{new_lead}", {
            "Status": "Qualified",
            "AnnualRevenue": "2500000",
            "NumberOfEmployees": "40"
        })
    yield send("PATCH", f"sobjects/Lead/{lead}", {
        "Rating": "Hot",
        "OwnerId": user
    })
    yield send("PATCH", f"sobjects/Lead/{lead}", {"NumberOfEmployees": "lots"})
    yield send("PATCH", "sobjects/Lead/nope", {"Rating": "Hot"}, base=OLD)
    yield send(
        "PATCH", f"sobjects/Account/{new_account}", {
            "Name": "Globex Corp",
            "Tier": "Gold",
            "Phone": "",
            "HealthStatus": "Green",
            "NumberOfEmployees": 300
        })
    yield send("PATCH", f"sobjects/Account/{account}", {
        "Priority": "High",
        "AnnualRevenue": "bad",
        "Tier": "Silver"
    })
    yield send("PATCH", "sobjects/Account/nope", {"Tier": "Gold"})
    yield send(
        "PATCH", f"sobjects/Opportunity/{new_opp}", {
            "StageName": "Closed Won",
            "IsWon": True,
            "IsClosed": "true",
            "CloseDate": "2026-07-15",
            "Amount": 80000,
            "Risk_Level__c": "Low"
        })
    yield send("PATCH", f"sobjects/Opportunity/{opp}",
               {"CloseDate": "not a date"})
    yield send("PATCH", f"sobjects/Opportunity/{opp}", {
        "CloseDate": "2026-08-01T09:30:00Z",
        "NextStep": "Sign"
    })
    yield send("PATCH", f"sobjects/Opportunity/{opp}", {"Amount": "x"})
    yield send("PATCH", "sobjects/Opportunity/nope", {"Amount": 1})
    yield send("PATCH", f"sobjects/Case/{new_case}", {
        "Status": "Closed",
        "Priority": "Low"
    })
    yield send("PATCH", f"sobjects/Case/{case}", {
        "status": "Escalated",
        "is_escalated": True
    })
    yield send("PATCH", f"sobjects/Case/{case}", {"Bogus": 1})
    yield send("PATCH", f"sobjects/Campaign/{new_campaign}", {
        "Name": "Spring Launch 2",
        "status": "Completed"
    })
    yield send("PATCH", f"sobjects/User/{user}", {
        "title": "VP",
        "status": "inactive"
    })
    yield send("PATCH", f"sobjects/Task/{first_id('tasks')}", {
        "status": "Completed",
        "who_id": contact
    })
    yield send("PATCH", "sobjects/Widget/x", {"a": 1})
    yield send("PATCH", "sobjects/Case/nope", {"status": "x"})
    yield send("PUT",
               f"sobjects/Contact/{contact}", {"Name": "Full Name"},
               base=OLD)
    yield send("PUT",
               f"sobjects/Contact/{contact}", {
                   "account_id": new_account,
                   "title": "Legacy"
               },
               base=OLD)
    yield send("PUT",
               f"sobjects/Opportunity/{opp}", {
                   "Name": "Renamed",
                   "Amount": 1
               },
               base=OLD)
    yield send("PATCH", f"sobjects/Event/{first_id('events')}", {
        "subject": "Moved",
        "start_datetime": "2026-09-01T10:00:00"
    })

    # Lead conversion.
    yield send("POST",
               f"sobjects/Lead/{new_lead}/convert", {
                   "account": new_account,
                   "converted_status": "Closed - Converted"
               },
               base=OLD)
    yield send("POST",
               f"sobjects/Lead/{new_lead}/convert", {"account": new_account},
               base=OLD)
    yield send("PATCH",
               f"sobjects/Lead/{lead}/convert", {
                   "accountId": account,
                   "createOpportunity": False
               },
               base=OLD)
    yield send(
        "POST", "actions/standard/convertLead", {
            "inputs": [{
                "leadId": first_id("leads", 1),
                "accountId": account,
                "opportunityId": opp
            }]
        })
    yield send("POST", "actions/standard/convertLead", {
        "leadId": first_id("leads", 2),
        "accountId": "nope"
    })
    yield send("POST", "actions/standard/convertLead", {
        "leadId": "nope",
        "accountId": account
    })
    yield send("POST", "actions/standard/convertLead", {"inputs": [5]})
    yield send("POST", "actions/standard/convertLead", {
        "leadId": first_id("leads", 3),
        "accountId": account,
        "convertedStatus": 9
    })
    yield send("POST",
               f"sobjects/Lead/{lead}/convert", {"lead": "x"},
               base=OLD)

    # Reads after the writes.
    yield soql(
        "SELECT Id, Name, Title, AccountId, AccountName, NdaStatus, "
        "LastModifiedDate FROM Contact ORDER BY LastModifiedDate DESC, Name")
    yield soql(
        "SELECT Id, Name, Status, IsConverted, Company FROM Lead ORDER BY Name"
    )
    yield soql("SELECT Id, Name, StageName, Amount, CloseDate, IsWon FROM "
               "Opportunity ORDER BY CreatedDate DESC, Name")
    yield soql(
        "SELECT Id, Subject, Status FROM Case WHERE CreatedDate = TODAY")
    yield soql(
        "SELECT Id, Subject, WhoId, WhatId, OwnerId, ActivityDate FROM Task "
        "ORDER BY ActivityDate DESC")
    yield soql(
        "SELECT Id, Subject, StartDateTime, EndDateTime FROM Event ORDER BY "
        "StartDateTime")
    yield soql("SELECT FIELDS(ALL) FROM Note LIMIT 50")
    yield soql("SELECT FIELDS(ALL) FROM Attachment LIMIT 50")
    yield soql("SELECT FIELDS(ALL) FROM CaseComment LIMIT 50")
    yield soql(
        "SELECT Id, Name, Tier, HealthStatus, Phone FROM Account ORDER BY Name"
    )
    yield get("search", {"q": "FIND {Globex}"})
    yield get(f"sobjects/Contact/{new_contact}")
    yield get(f"sobjects/Lead/{new_lead}")

    # Deletes.
    yield send("DELETE", f"sobjects/Note/{first_id('notes')}")
    yield send("DELETE", f"sobjects/Contact/{new_contact}")
    yield send("DELETE", f"sobjects/Contact/{new_contact}")
    yield send("DELETE", "sobjects/Widget/x")
    yield send("DELETE", f"sobjects/Case/{new_case}", base=OLD)
    yield send("DELETE", f"sobjects/Account/{account}", {"ignored": 1})
    yield soql("SELECT COUNT() FROM Contact")

    # Unrouted.
    yield get("sobjects/Contact")
    yield send("POST", "sobjects/Widget", {})
    yield send("PUT", f"sobjects/Contact/{contact}", {})
    yield get("limits")
