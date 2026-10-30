"""Stage pinned Claw-Eval sources and JSON; scoring stays inside Mirage.

The compatibility backend uses Pyodide, not Monty: upstream relies on
inheritance, Pydantic and regex. No host Python grader or SQLite connection
is used here. The existing fake owns its storage and exports JSON.
"""
import ast
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from vfsbench_harbor.environment import HARBOR, ROOT

MANIFEST = HARBOR / "graders/claweval/manifest.json"
UPSTREAM = ROOT / "state/claweval/src"
GWS_TABLES = ["Message", "MessageLabel", "MessageHeader", "Event"]


def definitions():
    return json.loads(MANIFEST.read_text())["tasks"]


def assembly(source):
    """Keep the reference's trace assembly verbatim, excluding I/O backends.

    This is a source-selection adapter, not execution on the host. Only
    named functions/constants from the hash-checked reference are selected.
    SQL writes and service HTTP reads are replaced by the JSON input adapter.
    """
    names = {
        "steps", "messages", "results", "text_of", "dispatches", "flat", "now",
        "Trace", "summary", "reads", "gws_trace"
    }
    constants = {"ENDPOINTS", "BODY_KEY", "GWS"}
    parts = [
        "import json, re\n"
        "from datetime import datetime, timezone\n"
        "from pathlib import Path\n"
    ]
    for node in ast.parse(source).body:
        if isinstance(node,
                      (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            parts.append(ast.get_source_segment(source, node))
        elif isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in constants
                for t in node.targets):
            parts.append(ast.get_source_segment(source, node))
    return "\n\n".join(parts) + "\n"


def source_bytes(definition, budget):
    sources = {}
    for relative, expected in definition["sources"].items():
        path = UPSTREAM / relative
        if not path.resolve().is_relative_to(UPSTREAM.resolve()):
            raise ValueError("Claw-Eval source leaves its checkout")
        data = b"".join(budget.chunks(path))
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Claw-Eval reference changed: {relative}; "
                             "review parity before repinning")
        sources["/reference/" + relative] = data
    source = b"".join(budget.chunks(HARBOR / "claweval_grade.py"))
    expected = json.loads(MANIFEST.read_text())["adapter_sha256"]
    if hashlib.sha256(source).hexdigest() != expected:
        raise ValueError(
            "Claw-Eval trace adapter changed; review parity before repinning")
    sources["/reference/assembly.py"] = assembly(source.decode()).encode()
    return sources


async def freeze(verifier, definition, stage, budget):
    frozen = await verifier._background(verifier._freeze_files,
                                        definition,
                                        stage,
                                        budget=budget)
    # State and reference code never share the agent's writable mounts.
    sources = await verifier._background(source_bytes,
                                         definition,
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
        "task": verifier.task.name,
        "audit": audits,
        "gws": state,
        "epoch": verifier.environment.now().isoformat()
    }
    tests = verifier._resolve_tests()[1]

    def store(budget):
        for i, (virtual, data) in enumerate(sources.items()):
            target = stage / f"source-{i}"
            target.write_bytes(data)
            target.chmod(0o400)
            frozen["files"][virtual] = str(target)
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
        recording = getattr(verifier, "claweval_recording", None)
        if recording is not None:
            target = stage / "recording.json"
            budget.copy(Path(recording), target)
            frozen["files"]["/input/recording.json"] = str(target)
        return frozen

    return await verifier._background(store, budget=budget)
