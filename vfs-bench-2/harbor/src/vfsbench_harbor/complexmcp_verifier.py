"""Freeze ComplexMCP inputs; all score computation runs inside Mirage/Monty."""
import hashlib
import json

import httpx
from vfsbench_harbor.environment import HARBOR, ROOT

MANIFEST = HARBOR / 'graders/complexmcp/manifest.json'
PORTS = {
    'LightSystem': 9000,
    'LightTalk': 9001,
    'LightShop': 9002,
    'LightWeather': 9003,
    'LightFlight': 9004,
    'LightStock': 9005,
    'LightNews': 9006
}


def definitions():
    return json.loads(MANIFEST.read_text())['tasks']


async def freeze(verifier, definition, stage, budget):

    def expected(budget):
        manifest = json.loads(MANIFEST.read_text())
        for name, relative in (("judge.py", "benchmark/judge.py"),
                               ("dist.py", "software/utils/dist.py")):
            source = ROOT / "state/complexmcp/src" / relative
            digest = hashlib.sha256(b"".join(
                budget.chunks(source))).hexdigest()
            if digest != manifest["reference"][name]:
                raise ValueError(f"ComplexMCP reference {name} changed; "
                                 "verify parity before updating its pin")
        # Original row includes the app order, seed and gold environment.
        # Do not accept a task's or agent's replacement gold data.
        rows = json.loads(b''.join(
            budget.chunks(ROOT / 'state/complexmcp/tasks.json')))
        row = rows[definition['row']]
        digest = hashlib.sha256(
            json.dumps(row, sort_keys=True,
                       ensure_ascii=True).encode()).hexdigest()
        if digest != definition['row_sha256']:
            raise ValueError(
                'ComplexMCP row changed; verify parity before updating its pin'
            )
        return row['gt_env']

    gold = await verifier._background(expected, budget=budget)
    # These fake endpoints are read-only views of the existing trial. There
    # is no live-service access or host callback from the Monty workspace.
    routes = verifier.environment.routes
    states = {'initial': {}, 'final': {}, 'expected': gold}
    async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
        for which, endpoint in (('initial', 'login'), ('final', 'logout')):
            for app in definition['apps']:
                port = PORTS[app]
                if port not in routes:
                    raise ValueError(f'No ComplexMCP trial route for {app}')
                async with client.stream('POST',
                                         routes[port] + '/' + endpoint,
                                         content=b'') as reply:
                    reply.raise_for_status()
                    body = bytearray()
                    async for data in reply.aiter_bytes():
                        budget.charge(len(data))
                        body.extend(data)
                states[which][app] = json.loads(body)
    target = stage / 'complexmcp.json'
    await verifier._background(
        lambda budget: budget.write_json(target, states), budget=budget)
    target.chmod(0o400)
    # Host-only replay evidence, subject to Harbor's log filters. This is
    # never mounted into the agent workspace.
    await verifier._background(lambda budget: verifier._log(
        verifier.trial_paths.verifier_dir / 'complexmcp-inputs.json',
        target.read_text()),
                               budget=budget)
    return {'states': {}, 'files': {'/input/state.json': str(target)}}
