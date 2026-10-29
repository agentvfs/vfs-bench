"""BambooHR calls: every route of tools/api/routes/bamboohr.py. The seeded
worlds hold no actions, so these write each kind first (employees, files,
tables, time off, goals, training, reports) and the reads then find them,
with their filters; and error cases: ``**`` of a non-mapping, clashing
arguments, unhashable and odd-typed values."""
import json

KNOWN = {}

BASE = "https://api.bamboohr.com/api/gateway.php/acme/v1/"


def fetch(method, path, body=None, params=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    # Reads of an empty world.
    yield fetch("GET", "employees/directory")
    yield fetch("GET", "employees/123")
    yield fetch("GET",
                "employees/changed",
                params={"since": "2026-01-01T00:00:00Z"})
    yield fetch("GET", "meta/time_off/policies")
    yield fetch("GET", "training/type")
    # Employees.
    yield fetch(
        "POST", "employees", {
            "firstName": "Ada",
            "lastName": "Lovelace",
            "jobTitle": "Engineer",
            "hireDate": "2026-03-01",
            "salary": 120000.0,
            "tags": ["a", 1]
        })
    yield fetch("POST", "employees", {})
    yield fetch("POST", "employees/123", {
        "jobTitle": "Senior Engineer",
        "department": "R&D"
    })
    yield fetch("POST", "employees/abc", {"employee_id": "dup"})
    yield fetch("POST", "employees/abc", {"world": 1})
    yield fetch("POST", "employees", "[1]")
    yield fetch("GET",
                "employees/123",
                params={
                    "fields": "firstName,lastName",
                    "onlyCurrent": True
                })
    yield fetch("GET", "employees/123", params={"employee_id": "x"})
    yield fetch("GET", "employees/123", params="[1]")
    yield fetch("GET",
                "employees/directory",
                params={
                    "onlyCurrent": False,
                    "extra": 1
                })
    # Files.
    yield fetch("POST", "employees/123/files", {
        "fileName": "offer.pdf",
        "category": 3,
        "share": "yes"
    })
    yield fetch("GET", "employees/123/files/view")
    yield fetch("GET", "employees/999/files/view")
    yield fetch("GET", "employees/123/files/f1")
    yield fetch("POST", "employees/123/files/f1", {"name": "renamed.pdf"})
    yield fetch("POST", "employees/123/files/f1", {"file_id": "x"})
    yield fetch("DELETE", "employees/123/files/f1")
    # Tables.
    yield fetch("POST", "employees/123/tables/jobInfo", {
        "date": "2026-04-01",
        "jobTitle": "Lead",
        "location": None
    })
    yield fetch("POST", "employees/123/tables/jobInfo/7",
                {"jobTitle": "Principal"})
    yield fetch("POST", "employees/123/tables/jobInfo/7", {"row_id": 1})
    yield fetch("GET", "employees/123/tables/jobInfo")
    yield fetch("GET", "employees/123/tables/compensation")
    yield fetch("GET",
                "employees/changed/tables/jobInfo",
                params={"since": "2026-01-01"})
    yield fetch("GET",
                "employees/changed/tables/jobInfo",
                params={"since": ""})
    # Time off.
    yield fetch(
        "PUT", "employees/123/time_off/request", {
            "start": "2026-04-10",
            "end": "2026-04-12",
            "timeOffTypeId": 78,
            "amount": 2.0,
            "status": "requested"
        })
    yield fetch("PUT", "time_off/requests/55/status", {
        "status": "approved",
        "note": "ok"
    })
    yield fetch("PUT", "employees/123/time_off/history", {
        "date": "2026-04-01",
        "amount": -1
    })
    yield fetch("PUT", "employees/123/time_off/policies",
                [{
                    "timeOffPolicyId": 1,
                    "accrualStartDate": "2026-01-01"
                }])
    yield fetch("PUT", "employees/123/time_off/policies",
                {"policies": [{
                    "timeOffPolicyId": 1
                }]})
    yield fetch("GET",
                "time_off/requests",
                params={
                    "start": "2026-04-01",
                    "end": "2026-04-30",
                    "employeeId": "123",
                    "status": "approved",
                    "action": "view"
                })
    yield fetch("GET", "time_off/requests")
    yield fetch("GET", "time_off/whos_out", params={"start": "2026-04-01"})
    yield fetch("GET",
                "employees/123/time_off/calculator",
                params={"end": "2026-12-31"})
    yield fetch("GET", "meta/time_off/types")
    # Reports.
    yield fetch("GET", "reports/42", params={"format": "JSON", "fd": "yes"})
    yield fetch("POST",
                "reports/custom", {
                    "title": "Headcount",
                    "fields": ["firstName", "department"]
                },
                params={"format": "JSON"})
    yield fetch("POST", "reports/custom", {
        "fields": ["id"],
        "employees": [{
            "id": "1"
        }]
    })
    yield fetch("POST", "reports/custom", "[1]")
    yield fetch("POST", "reports/custom", {}, params="[1]")
    yield fetch("POST", "reports/custom", {"onlyCurrent": True, "title": 5})
    # Goals.
    yield fetch(
        "POST", "performance/employees/123/goals", {
            "title": "Ship v2",
            "percentComplete": 40,
            "status": "open",
            "dueDate": "2026-06-30"
        })
    yield fetch("POST", "performance/employees/123/goals", {
        "title": "Hire",
        "percentComplete": 75.5,
        "status": "completed"
    })
    yield fetch("POST", "performance/employees/123/goals", {
        "title": "Bool",
        "percentComplete": True,
        "status": "closed"
    })
    yield fetch("POST", "performance/employees/123/goals", {
        "title": "Text",
        "percentComplete": "50",
        "status": 3
    })
    yield fetch("PUT", "performance/employees/123/goals/g1", {
        "percentComplete": 90,
        "status": "open"
    })
    yield fetch("GET", "performance/employees/123/goals")
    yield fetch("GET",
                "performance/employees/123/goals",
                params={"filter": "status-open"})
    yield fetch("GET", "performance/employees/123/goals/statusCount")
    yield fetch("GET", "performance/employees/123/goals/aggregate")
    yield fetch("GET", "performance/employees/456/goals/aggregate")
    yield fetch("POST", "performance/employees/456/goals", {
        "percentComplete": 1,
        "status": ["open"]
    })
    yield fetch("GET", "performance/employees/456/goals/statusCount")
    yield fetch("POST", "performance/employees/789/goals", {
        "percentComplete": 1,
        "status": None
    })
    yield fetch("POST", "performance/employees/789/goals", {
        "percentComplete": 2,
        "status": 1
    })
    yield fetch("GET", "performance/employees/789/goals/statusCount")
    yield fetch("GET", "performance/employees/789/goals/aggregate")
    yield fetch("DELETE", "performance/employees/123/goals/g1")
    # Training.
    yield fetch("POST", "training/type", {
        "name": "Safety",
        "frequency": 12,
        "category": {
            "id": 1
        }
    })
    yield fetch("PUT", "training/type/9", {"name": "Safety 2"})
    yield fetch("DELETE", "training/type/9")
    yield fetch("POST", "training/category", {"name": "Compliance"})
    yield fetch("PUT", "training/category/3", {"name": "Legal"})
    yield fetch("DELETE", "training/category/3")
    yield fetch("GET", "training/category")
    yield fetch("POST", "training/record/123", {
        "type": 9,
        "completed": "2026-03-15",
        "hours": 1.5
    })
    yield fetch("PUT", "training/record/123/r1", {"hours": 2})
    yield fetch("DELETE", "training/record/123/r1")
    yield fetch("GET", "training/record/123")
    yield fetch("GET", "training/record/123", params={"trainingTypeId": "9"})
    yield fetch("GET", "training/type")
    # Employees changed, keyed by each result's id.
    yield fetch("GET", "employees/changed", params={"type": "updated"})
    yield fetch("GET", "employees/directory")
    yield fetch("GET", "employees/123")
    # Other spellings of the base URL upstream maps.
    yield fetch("GET",
                "v1/employees/directory",
                base="https://api.bamboohr.com/")
    yield fetch("GET",
                "bamboohr/v1/meta/time_off/types",
                base="https://acme.bamboohr.com/")
    yield fetch("GET", "employees/123/nothing")
    yield fetch("PATCH", "employees/123", {})
