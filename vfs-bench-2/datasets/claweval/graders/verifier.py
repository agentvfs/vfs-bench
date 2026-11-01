"""Stage a Claw-Eval trial's frozen inputs for its native grader (index.ts).

The trajectory and the tool CLIs' dispatches are the trial's files; each
service's audit is fetched from the trial's run of its fake, at its
upstream port; the gws fake's tables are exported as JSON. No SQLite
connection is used here.
"""
import json
from pathlib import Path
from urllib.parse import urlsplit

import httpx

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"
GWS_TABLES = ["Message", "MessageLabel", "MessageHeader", "Event"]


def definitions():
    return json.loads(MANIFEST.read_text())["tasks"]


async def freeze(verifier, definition, stage, budget):
    frozen = await verifier._background(verifier._freeze_files,
                                        definition,
                                        stage,
                                        budget=budget)
    audits = {}
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        for service, endpoint in definition["audits"].items():
            parts = urlsplit(endpoint)
            route = verifier.environment.routes.get(parts.port)
            if route is None:
                raise ValueError(f"No Claw-Eval audit route for {service}")
            async with client.stream("GET", route + parts.path) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    budget.charge(len(chunk))
                    data.extend(chunk)
                audits[service] = json.loads(data)
    state = {}
    if definition["gws"]:
        exported = await verifier.environment.snapshot_verifier_states(
            {"gws": {
                "service": "gws",
                "tables": GWS_TABLES
            }})
        state = exported["gws"]
    inputs = {
        "task": verifier.task_id,
        "audit": audits,
        "gws": state,
        "epoch": verifier.environment.now().isoformat()
    }
    tests = verifier.inputs_dir

    def store(budget):
        for original, target in (
            ("/logs/agent/trajectory.json", "/input/trajectory.json"),
            ("/var/lib/mock-data/claweval/dispatches.jsonl",
             "/input/dispatches.jsonl")):
            if original in frozen["files"]:
                frozen["files"][target] = frozen["files"].pop(original)
        if definition["gws"]:
            target = stage / "seed.json"
            budget.copy(tests / "gws_seed.json", target)
            frozen["files"]["/input/gws_seed.json"] = str(target)
        target = stage / "inputs.json"
        budget.write_json(target, inputs)
        target.chmod(0o400)
        frozen["files"]["/input/state.json"] = str(target)
        return frozen

    return await verifier._background(store, budget=budget)
