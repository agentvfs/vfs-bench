"""Check the ERPBench fake (mocks/erpbench) against upstream's Python world.

    python3 -I harbor/erpbench_compare.py [task ...] [-v]

For each task (default: all 100) and each of upstream's grading policies
(``evaluation.POLICIES``, ``policy_steps``), this makes the same calls on
upstream's ``ErpWorld`` in this process (a fresh ``ErpWorld.create``) and on
a fresh run of the fake (``POST /reset`` with the task's fixture and epoch,
then ``/_run/<run>/<tool>``). The fake gets each call's arguments as the
workspace's CLI sends them (``wire``: a whole float is an int, a flag left
out for None); upstream gets that same JSON with the fake's own coercion
(``coerce``: a value the tool's schema types ``number`` a float). On one
task per workflow family it then sends malformed calls (``probes``): every
tool with no arguments, every write outside the task, wrong types, unknown
tools.

It compares, call by call, the success flag and the reply (parsed, so ``1``
and ``1.0`` differ); after the seed and at the end of each run, upstream's
snapshot of its 31 tables against the same snapshot of the run's database;
and the trace, upstream's ``world.trace`` against the fake's ``_trace``.

Then it grades: upstream's ``score_episode`` on the fake's end state and
trace must give the reward upstream's ``run_episode`` gives with the
policy's arguments as upstream wrote them (no CLI in between).

Exits 1 on any difference ``KNOWN`` does not accept.
"""
import argparse
import contextlib
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from collections import Counter
from copy import deepcopy
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
UPSTREAM = (ROOT / "state" / "erpbench" / "src" / "benchmark" / "erpbench100" /
            "release" / "harbor" / "tasks")
sys.path.insert(0, str(UPSTREAM / "erpbench-001" / "tests"))

from erpbench100.evaluation import POLICIES  # noqa: E402
from erpbench100.evaluation import policy_steps  # noqa: E402
from erpbench100.evaluation import run_episode  # noqa: E402
from erpbench100.evaluation import score_episode  # noqa: E402
from erpbench100.spec import AS_OF, world_model  # noqa: E402
from erpbench100.world import TABLES  # noqa: E402
from erpbench100.world import WRITE_TOOLS  # noqa: E402
from erpbench100.world import ErpWorld  # noqa: E402
from erpbench100.world import tool_definitions  # noqa: E402

# Accepted differences: a substring of the call's label -> why.
KNOWN: dict[str, str] = {}


class Fake:
    """The fake, started as harbor/fakes.ts starts a job's."""

    service = "erpbench"

    def __init__(self, root: Path):
        self.root = root
        fixtures = root / "fixtures" / self.service
        fixtures.mkdir(parents=True, exist_ok=True)
        (fixtures / "default.json").write_text('{"seed": []}\n')
        self.proc = subprocess.Popen([
            "node",
            str(HARBOR / "fakes.ts"), "--service", self.service, "--root",
            str(root), "--fixture", "default", "--log",
            str(root / "fake.log")
        ],
                                     cwd=ROOT,
                                     stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE,
                                     text=True)
        for line in self.proc.stdout:
            if line.startswith("FAKE="):
                ready = json.loads(line[5:])
                self.url, self.state_root = ready["url"], Path(ready["state"])
                return
        raise RuntimeError(f"the fake did not start (see {root})")

    def open(self, run: str, task_id: str) -> None:
        data = json.dumps({"seed": [{"id": 1, "task": task_id}]}).encode()
        name = f"f-{hashlib.sha256(data).hexdigest()[:12]}"
        (self.root / "fixtures" / self.service /
         f"{name}.json").write_bytes(data)
        body = json.dumps({
            "run": run,
            "fixture": name,
            "epoch": AS_OF
        }).encode()
        request = urllib.request.Request(
            f"{self.url}/reset",
            data=body,
            headers={"content-type": "application/json"})
        urllib.request.urlopen(request, timeout=120).read()
        self.run = run

    def db(self) -> Path:
        files = list(
            self.state_root.glob(f"mirage-kit-{self.service}-*/{self.run}.db"))
        assert len(files) == 1, files
        return files[0]

    def call(self, tool: str, body: str) -> tuple[bool, str]:
        """Whether the call succeeded (200; an error is a 400), and the
        reply's text."""
        request = urllib.request.Request(
            f"{self.url}/_run/{self.run}/{tool}",
            data=body.encode(),
            headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as reply:
                return True, reply.read().decode()
        except urllib.error.HTTPError as error:
            text = error.read().decode()
            if error.code == 400:
                return False, text
            return False, f"<HTTP {error.code}: {text[:2000]}>"

    def state(self, task: dict) -> tuple[dict, dict, list]:
        """Upstream's snapshot, the trace and the raw rows of a copy of the
        run's lone database file, as the grader reads one."""
        copy = self.root / "copy.db"
        shutil.copyfile(self.db(), copy)
        with contextlib.closing(sqlite3.connect(copy)) as conn:
            trace = [
                json.loads(entry)
                for (entry,
                     ) in conn.execute("SELECT entry FROM _trace ORDER BY idx")
            ]
            return (*tables(task, conn), trace)

    def stop(self) -> None:
        self.proc.stdin.close()
        self.proc.wait()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def first_difference(a, b, path="") -> str:
    if type(a) is not type(b):
        return f"{path or '/'}: {canonical(a)[:300]} != {canonical(b)[:300]}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                side = 'upstream' if k in a else 'fake'
                return f"{path}/{k}: only in {side}"
            d = first_difference(a[k], b[k], f"{path}/{k}")
            if d:
                return d
        return ""
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: {len(a)} items != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return ""
    if a == b:
        return ""
    return f"{path}: {canonical(a)[:300]} != {canonical(b)[:300]}"


def intify(value):
    """A value as JS's ``JSON.stringify`` writes it: a whole float an int."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [intify(v) for v in value]
    if isinstance(value, dict):
        return {k: intify(v) for k, v in value.items()}
    return value


def wire(arguments: dict, schema: dict) -> dict:
    """The arguments as the CLI (clis/tools.ts ``argumentsFrom``) sends
    them."""
    props = schema["properties"]
    out = {}
    for name, value in arguments.items():
        if value is None or name not in props:
            continue
        kind = props[name].get("type")
        if kind == "string":
            value = str(value)
        elif kind == "array" and props[name].get("items",
                                                 {}).get("type") == "string":
            value = [str(v) for v in value]
        out[name] = intify(value)
    return out


def coerce(value, schema):
    """The fake's coercion: a value its schema types ``number`` a float."""
    if not isinstance(schema, dict):
        return value
    kind = schema.get("type")
    if kind == "number" and isinstance(value,
                                       int) and not isinstance(value, bool):
        return float(value)
    if kind == "object" and isinstance(value, dict) and isinstance(
            schema.get("properties"), dict):
        return {
            k: coerce(v, schema["properties"].get(k))
            for k, v in value.items()
        }
    if kind == "array" and isinstance(value, list):
        return [coerce(v, schema.get("items")) for v in value]
    return value


def probes(task: dict, model: dict) -> list[tuple[str, dict]]:
    """Malformed calls: missing arguments, writes outside the task, wrong
    types."""
    tid = task["task_id"]
    world = model["world"]
    short = world["short"]
    item = model["items"][0]["item_number"]
    inactive = next((i for i in model["items"] if i["status"] != "Active"),
                    model["items"][0])
    po = model["receiving_ap_match"]["po"]
    sheet = f"SHEET-{short}-OPS"
    out = [(t["name"], {}) for t in tool_definitions()]
    out += [(name, {
        "task_id": "erpbench-999"
    }) for name in sorted(WRITE_TOOLS)]
    order = {
        "task_id": tid,
        "SourceTransactionNumber": "PROBE-1",
        "SourceTransactionSystem": "OPS",
        "CustomerPONumber": "PO-PROBE",
        "TransactionType": "Standard Orders",
        "RequestedFulfillmentOrganizationCode": world["org"],
        "SubmittedFlag": False,
    }
    out += [
        ("nope", {}),
        ("oracle_fusion.nope.list", {
            "q": "x"
        }),
        ("erpbench.get_task", {
            "task_id": "erpbench-999"
        }),
        ("erpbench.submit_answer", {
            "task_id": tid,
            "answers": []
        }),
        ("erpbench.record_decision", {
            "task_id": tid,
            "decision": "x"
        }),
        ("oracle_fusion.items.list", {
            "q": 5
        }),
        ("oracle_fusion.items.list", {
            "q":
            f"ItemNumber='{item}' AND constructor='x' and ItemNumber='{item}'"
        }),
        ("oracle_fusion.items.update", {
            "task_id": tid,
            "ItemId": "abc",
            "ListPrice": 1.0,
            "EffectiveDate": "2026-03-01"
        }),
        ("oracle_fusion.items.update", {
            "task_id": tid,
            "ItemId": model["items"][0]["item_id"],
            "ListPrice": "12",
            "EffectiveDate": "2026-03-01"
        }),
        ("oracle_fusion.items.update", {
            "task_id": tid,
            "ItemId": model["items"][0]["item_id"],
            "ListPrice": True,
            "EffectiveDate": "2026-03-01"
        }),
        ("oracle_fusion.items.update", {
            "task_id": tid,
            "ItemId": model["items"][0]["item_id"],
            "ListPrice": -5
        }),
        ("oracle_fusion.items.update", {
            "task_id": tid,
            "ItemId": inactive["item_id"],
            "ListPrice": 9.99,
            "EffectiveDate": "2026-03-01"
        }),
        ("oracle_fusion.customer_account_activities.get", {
            "AccountId": ["x"]
        }),
        ("oracle_fusion.customer_account_activities.get", {
            "AccountId": f"CUST-{short}-DECOY2"
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": "abc"
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [1]
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [{
                "ProductNumber": [1]
            }]
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [{
                "ProductNumber": "NOPE"
            }]
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [{
                "ProductNumber": item,
                "OrderedQuantity": "two"
            }]
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [{
                "ProductNumber": item,
                "OrderedQuantity": 2,
                "UnitListPrice": None
            }]
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [{
                "ProductNumber": inactive["item_number"],
                "OrderedQuantity": 2
            }]
        }),
        ("oracle_fusion.sales_orders.create", {
            **order
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "OrderTotal": 10,
            "CustomerPONumber": 5
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "OrderTotal": 10,
            "TransactionType": None
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "lines": [{
                "ProductNumber": item,
                "OrderedQuantity": " 3 ",
                "UnitListPrice": "12.125",
                "OrderedUOM": {
                    "u": 1
                }
            }],
            "BuyingPartyNumber":
            f"CUST-{short}-DECOY1"
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "OrderTotal": 10.005,
            "SourceTransactionNumber": "PROBE-2",
            "SubmittedFlag": "yes"
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "OrderTotal": 10
        }),
        ("oracle_fusion.sales_orders.create", {
            **order, "SourceTransactionSystem": world["channel"],
            "SourceTransactionNumber": "NOPE",
            "OrderTotal": 1
        }),
        ("oracle_fusion.shipment_lines.update", {
            "task_id":
            tid,
            "ShipmentLine":
            model["shipment_verification"]["lines"][0]["shipment_line_id"],
            "ShippedQuantity":
            "x"
        }),
        ("oracle_fusion.shipment_lines.update", {
            "task_id":
            tid,
            "ShipmentLine":
            model["shipment_verification"]["lines"][0]["shipment_line_id"],
            "ShippedQuantity":
            10**6
        }),
        ("oracle_fusion.shipment_lines.update", {
            "task_id": tid,
            "ShipmentLine": str(700000 + len(short)),
            "ShippedQuantity": 1
        }),
        ("oracle_fusion.standard_receipts.create", {
            "task_id": tid,
            "CustomerAccountNumber": world["customer"]["number"],
            "ReceiptNumber": "R-P",
            "remittanceReferences": []
        }),
        ("oracle_fusion.standard_receipts.create", {
            "task_id": tid,
            "CustomerAccountNumber": world["customer"]["number"],
            "ReceiptNumber": "R-P",
            "remittanceReferences": [{
                "ReferenceNumber": "NOPE"
            }]
        }),
        ("oracle_fusion.standard_receipts.create", {
            "task_id": tid,
            "CustomerAccountNumber": world["customer"]["number"],
            "ReceiptNumber": "R-P",
            "remittanceReferences": [{
                "ReferenceNumber": f"INV-{short}-DECOY"
            }]
        }),
        ("oracle_fusion.standard_receipts.create", {
            "task_id":
            tid,
            "CustomerAccountNumber":
            world["customer"]["number"],
            "ReceiptNumber":
            "R-P",
            "ReceiptAmount":
            1,
            "remittanceReferences": [{
                "ReferenceNumber":
                model["receivables_collection"]["invoices"][0]
                ["transaction_number"],
                "ApplyAmount":
                "abc"
            }]
        }),
        ("oracle_fusion.standard_receipts.create", {
            "task_id":
            tid,
            "CustomerAccountNumber":
            world["customer"]["number"],
            "ReceiptNumber":
            "R-P",
            "ReceiptAmount":
            1,
            "remittanceReferences": [{
                "ReferenceNumber":
                model["receivables_collection"]["invoices"][0]
                ["transaction_number"],
                "ApplyAmount":
                2
            }]
        }),
        ("oracle_fusion.suppliers.list", {
            "q": "SUP-NOPE"
        }),
        ("oracle_fusion.suppliers.list", {
            "q": 7
        }),
        ("oracle_fusion.purchase_requisitions.create", {
            "task_id": tid,
            "lines": [{
                "ItemNumber": "NOPE",
                "Quantity": 1
            }]
        }),
        ("oracle_fusion.purchase_requisitions.create", {
            "task_id": tid,
            "lines": [{
                "ItemNumber": item,
                "Quantity": 0
            }]
        }),
        ("oracle_fusion.purchase_requisitions.create", {
            "task_id": tid,
            "RequisitioningBU": "BU",
            "Preparer": "p",
            "Description": "d",
            "Justification": "j",
            "lines": [{
                "ItemNumber": item,
                "Quantity": 2,
                "UnitPrice": 0.125
            }]
        }),
        ("oracle_fusion.purchase_requisitions.submit", {
            "task_id": tid,
            "purchaseRequisitionsUniqID": "NOPE"
        }),
        ("oracle_fusion.receiving_receipt_requests.create", {
            "task_id":
            tid,
            "lines": [{
                "DocumentNumber": po,
                "DocumentLineNumber": 1,
                "Quantity": 10**6
            }]
        }),
        ("oracle_fusion.receiving_receipt_requests.create", {
            "task_id":
            tid,
            "lines": [{
                "DocumentNumber": po,
                "DocumentLineNumber": 99,
                "Quantity": 1
            }]
        }),
        ("oracle_fusion.invoices.create", {
            "task_id":
            tid,
            "InvoiceNumber":
            "AP-P",
            "Supplier":
            world["supplier"]["name"],
            "invoiceLines": [{
                "PurchaseOrderNumber": po,
                "PurchaseOrderLineNumber": 1,
                "Quantity": 1,
                "UnitPrice": 0
            }]
        }),
        ("oracle_fusion.invoices.create", {
            "task_id":
            tid,
            "InvoiceNumber":
            "AP-P",
            "Supplier":
            world["supplier"]["name"],
            "InvoiceAmount":
            1,
            "invoiceLines": [{
                "PurchaseOrderNumber": po,
                "PurchaseOrderLineNumber": "1",
                "Quantity": 1,
                "UnitPrice": 5
            }]
        }),
        ("oracle_fusion.invoices.validate", {
            "task_id": tid,
            "ProcessAction": "Approve"
        }),
        ("oracle_fusion.invoice_holds.create", {
            "task_id": tid,
            "InvoiceId": model["receiving_ap_match"]["invoice_id"],
            "HoldReason": "  "
        }),
        ("oracle_fusion.workers.create", {
            "task_id": tid,
            "PersonNumber": "P-NEW",
            "CandidateId": "C-NEW",
            "LegalEmployerName": "Other Co"
        }),
        ("oracle_fusion.document_records.update", {
            "task_id":
            tid,
            "DocumentRecordId":
            model["document_compliance"]["documents"][0]["document_record_id"]
        }),
        ("oracle_fusion.document_records.update", {
            "task_id":
            tid,
            "DocumentRecordId":
            model["document_compliance"]["documents"][0]["document_record_id"],
            "Status":
            None
        }),
        ("oracle_fusion.absences.create", {
            "task_id": tid,
            "personNumber": "NOPE"
        }),
        ("gmail.messages.list", {
            "q": ["x"]
        }),
        ("gmail.messages.list", {
            "q": 5
        }),
        ("gmail.drafts.create", {
            "task_id": tid,
            "to": "a@b",
            "body": " \n"
        }),
        ("google_drive.files.list", {
            "q": 5
        }),
        ("google_drive.files.list", {
            "q": "name contains 'ÉCHÉANCE'"
        }),
        ("google_sheets.spreadsheets.values.get", {
            "spreadsheetId": sheet,
            "range": ["x"]
        }),
        ("google_sheets.spreadsheets.values.get", {
            "spreadsheetId": sheet,
            "range": "Nope!A1"
        }),
        ("google_sheets.spreadsheets.values.update", {
            "task_id": tid,
            "spreadsheetId": sheet,
            "range": "A1",
            "values": [1, 2]
        }),
        ("google_sheets.spreadsheets.values.update", {
            "task_id": tid,
            "spreadsheetId": sheet,
            "range": ["x"],
            "values": [[1]]
        }),
        ("google_sheets.spreadsheets.values.update", {
            "task_id": tid,
            "spreadsheetId": sheet,
            "range": 5,
            "values": [[1]]
        }),
        ("google_sheets.spreadsheets.values.append", {
            "task_id": tid,
            "spreadsheetId": sheet,
            "range": "Probe!A1",
            "valueInputOption": "RAW",
            "values": [["é", 1.5, None, True]]
        }),
        ("google_sheets.spreadsheets.values.append", {
            "task_id": tid,
            "spreadsheetId": sheet,
            "range": "Probe!A1",
            "valueInputOption": "RAW",
            "values": [["x\u2028\"y"]]
        }),
        ("slack.search_messages", {
            "query": 5
        }),
        ("slack.chat_postMessage", {
            "task_id": tid,
            "channel": "#x",
            "text": "t",
            "review_status": "sent"
        }),
    ]
    return out


def tables(task: dict, conn: sqlite3.Connection) -> tuple[dict, dict]:
    """Upstream's snapshot of the 31 tables, and their rows as stored
    (``*_json`` undecoded)."""
    raw = {
        t: [list(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY 1")]
        for t in TABLES
    }
    return ErpWorld(task, conn).snapshot(), raw


def compare_run(task: dict, policy: str, steps: list[tuple[str, str, dict]],
                fake: Fake, run: str, verbose: bool) -> tuple[int, int]:
    """Make the calls on upstream and on a fresh run: (calls, differences)."""
    sent = failed = 0
    with tempfile.TemporaryDirectory(prefix="erpbench-cmp-") as tmp:
        world = ErpWorld.create(task, Path(tmp) / "world.sqlite")
        fake.open(run, task["task_id"])
        mine, theirs = tables(task, world.connection), fake.state(task)
        d = first_difference(mine[0], theirs[0]) or first_difference(
            mine[1], theirs[1])
        if d:
            failed += 1
            print(f"  DIFF {task['task_id']} {policy} seed: {d}")
        for tool, body, arguments in steps:
            label = f"{tool} {body[:200]}"
            result = world.call_tool(tool, arguments)
            mine = (world.trace[-1]["success"], json.loads(json.dumps(result)))
            ok, text = fake.call(tool, body)
            sent += 1
            d = "" if mine[0] == ok else f"success {mine[0]} != {ok}"
            expected = json.dumps(result, ensure_ascii=False, sort_keys=True)
            d = d or ("" if text == expected else
                      f"reply text {expected[:300]} != {text[:300]}")
            if d:
                why = next((v for k, v in KNOWN.items() if k in label), None)
                failed += why is None
                print(f"  {'known' if why else 'DIFF'} {task['task_id']} "
                      f"{policy} {label}: {d}" + (f" ({why})" if why else ""))
            elif verbose:
                print(f"  same {label}: {canonical(mine[1])[:160]}")
        snapshot, raw, trace = fake.state(task)
        mine = tables(task, world.connection)
        for what, a, b in (("snapshot", mine[0], snapshot), ("stored rows",
                                                             mine[1], raw),
                           ("trace", json.loads(json.dumps(world.trace)),
                            trace)):
            d = first_difference(a, b)
            if d:
                failed += 1
                print(f"  DIFF {task['task_id']} {policy} {what}: {d}")
        world.close()
    return sent, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tasks", nargs="*")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    names = args.tasks or sorted(p.name for p in UPSTREAM.glob("erpbench-*"))
    total = failed = runs = 0
    rewards: dict[str, Counter] = {p: Counter() for p in POLICIES}
    probed: set[str] = set()
    with tempfile.TemporaryDirectory(prefix="erpbench-cmp-") as tmp:
        fake = Fake(Path(tmp))
        try:
            for name in names:
                task = json.loads(
                    (UPSTREAM / name / "tests" / "task.json").read_text())
                baseline = run_episode(task, [])["before"]
                schemas = {
                    t["name"]: t["inputSchema"]
                    for t in tool_definitions(task["answer_schema"])
                }
                for policy in POLICIES + ("probes", ):
                    if policy == "probes":
                        family = task["metadata"]["category"]
                        if family in probed and not args.tasks:
                            continue
                        probed.add(family)
                        raw = [(s["tool"],
                                wire(s.get("arguments", {}),
                                     schemas[s["tool"]]))
                               for s in policy_steps(task, "oracle")]
                        raw += probes(task, world_model(task["tenant_code"]))
                    else:
                        steps = policy_steps(task, policy)
                        raw = [(s["tool"],
                                wire(s.get("arguments", {}),
                                     schemas[s["tool"]])) for s in steps]
                    calls = []
                    for tool, sent_args in raw:
                        body = json.dumps(sent_args, ensure_ascii=False)
                        calls.append((tool, body,
                                      coerce(json.loads(body),
                                             schemas.get(tool))))
                    runs += 1
                    run = f"r{runs}"
                    s, f = compare_run(task, policy, calls, fake, run,
                                       args.verbose)
                    total += s
                    failed += f
                    if policy == "probes":
                        continue
                    upstream = run_episode(
                        task, deepcopy(steps))["verdict"]["reward"]
                    snapshot, _, trace = fake.state(task)
                    ours = score_episode(task, baseline, snapshot,
                                         trace)["reward"]
                    rewards[policy][round(ours, 4)] += 1
                    if ours != upstream:
                        failed += 1
                        print(f"  DIFF {name} {policy} reward: upstream "
                              f"{upstream} != fake {ours}")
                print(f"{name}: done ({total} calls, {failed} differences)",
                      flush=True)
        finally:
            fake.stop()
    for policy in POLICIES:
        print(f"reward {policy}: {dict(sorted(rewards[policy].items()))}")
    print(
        f"{len(names)} tasks, {runs} runs, {total} calls, {failed} differences"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
