"""Freeze ComplexMCP inputs; all score computation runs inside Mirage/Monty."""
import hashlib
import json
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'manifest.json'
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
        # The row: its app order, seed and gold environment, pinned, so
        # neither a task nor an agent replaces the gold data.
        row = json.loads(b''.join(
            budget.chunks(verifier.inputs_dir / 'row.json')))
        digest = hashlib.sha256(
            json.dumps(row, sort_keys=True,
                       ensure_ascii=True).encode()).hexdigest()
        if digest != definition['row_sha256']:
            raise ValueError('ComplexMCP row changed; regenerate the task')
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
