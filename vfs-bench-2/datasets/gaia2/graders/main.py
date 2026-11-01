"""Single-turn GAIA2 adapter, executed only inside the verifier's Monty VFS.

The frozen input holds service JSON, the trusted scenario and the trajectory.
The only external call is judge_completion(messages), a recorded LLM transport.
No state DB, event daemon, Python package loader or host grading callback runs.
"""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path


def reply_text(trajectory):
    for step in reversed(trajectory.get('steps', [])):
        if step.get('source') != 'agent':
            continue
        message = step.get('message')
        if isinstance(message, list):
            message = '\n'.join(
                p.get('text', '') for p in message if p.get('type') == 'text')
        if isinstance(message, str) and message.strip():
            return message
    return None


def evaluate_gaia2(state):
    loader = ScenarioLoader('/input/scenario.json')  # noqa: F821 - port.py
    # The Harbor exporter excludes multi-turn and Files-CLI scenarios.
    # Reject unsupported input explicitly instead of silently awarding a score.
    if sum(e.event_type == 'USER' for e in loader.events) != 1:
        raise ValueError('GAIA2 Mirage grading requires a single user turn')
    if any(e.event_type not in ('USER', 'AGENT') for e in loader.events):
        raise ValueError(
            'GAIA2 Mirage grading does not replay environment events')
    if any(e.event_type == 'AGENT' and e.action and e.action.app_name in (
            'Files', 'SandboxLocalFileSystem') for e in loader.events):
        raise ValueError('GAIA2 Files-CLI oracle is unsupported')

    # For this dataset's single turn, every reachable oracle event belongs to
    # turn zero. Validate graph reachability and terminal SMUs as the upstream
    # processor does before handing the parsed oracle to the unchanged judge.
    reached = set()
    pending = list(loader.events)
    while pending:
        ready = [
            e for e in pending if all(d in reached for d in e.dependency_ids)
        ]
        if not ready:
            raise ValueError('GAIA2 scenario contains an unreachable event')
        for event in ready:
            if any(loader._events_by_id[d].action and loader._events_by_id[d].
                   action.function_name == 'send_message_to_user'
                   for d in event.dependency_ids):
                raise ValueError(
                    'GAIA2 scenario contains more than one oracle turn')
            reached.add(event.event_id)
            pending.remove(event)
    oracle, graph, tasks, _ = loader.extract_oracle_data(
        {eid: 0
         for eid in reached}, 1)
    # Upstream constructs this DAG from a set, whose sibling order varies
    # with CPython's hash seed. Replay the reference's chosen order together
    # with its LLM replies so greedy matching sees exactly the same inputs.
    if 'oracle_order' in state:
        order = state['oracle_order']
        by_id = {event.event_id: event for event in oracle[0]}
        if len(order) != len(by_id) or set(order) != set(by_id):
            raise ValueError('Invalid GAIA2 reference oracle order')
        seen = set()
        for eid in order:
            if any(parent not in seen for parent in graph[0][eid]):
                raise ValueError(
                    'GAIA2 reference oracle order violates dependencies')
            seen.add(eid)
        oracle[0] = [by_id[eid] for eid in order]
    entries = []
    contacts = {}
    for service, tables in state['states'].items():
        for row in tables['event']:
            entries.append((row['wall'], row['seq'], row['entry']))
        if service == 'gaia2_contacts':
            for row in tables['doc']:
                if row['name'] == 'state':
                    contacts = json.loads(row['doc']).get('contacts', {})
    # Reference lay_out sorts the full SQLite tuples, including entry text
    # as the tie breaker when wall and per-service sequence are equal.
    calls = len(entries)
    lines = [json.loads(entry) for _, _, entry in sorted(entries)]
    reply = reply_text(state['trajectory'])
    if reply is not None:
        lines.append({
            't': loader.start_time,
            'app': 'AgentUserInterface',
            'fn': 'send_message_to_user',
            'args': {
                'content': reply
            },
            'w': True,
            'ret': None
        })
    user = None
    for contact in contacts.values():
        if contact.get('is_user'):
            user = UserDetails(  # noqa: F821 - port.py
                first_name=contact.get('first_name', ''),
                last_name=contact.get('last_name', ''),
                address=contact.get('address', ''))
            break
    completed = {}
    boundary = False
    reserved_ids = {
        str(entry['event_id'])
        for entry in lines if entry.get('event_id')
    }
    for index, entry in enumerate(lines):
        if 'app' not in entry or 'fn' not in entry:
            continue
        event_time = entry['t']
        if entry.get('sim_t'):
            try:
                event_time = datetime.strptime(
                    entry['sim_t'], '%Y-%m-%d %H:%M:%S').replace(
                        tzinfo=timezone.utc).timestamp()
            except (ValueError, TypeError):
                pass
        generated_id = f'mirage-generated-{index}'
        while generated_id in reserved_ids:
            generated_id += '_'
        event_id = str(entry.get('event_id') or generated_id)
        kind = 'ENV' if event_id.startswith(
            'Event-ENV-') else 'USER' if event_id.startswith(
                'Event-USER-') else 'AGENT'
        completed[event_id] = CompletedEvent(  # noqa: F821 - port.py
            event_id=event_id,
            event_type=kind,
            event_time=event_time,
            action=EventAction(  # noqa: F821 - port.py
                app_name=entry['app'],
                class_name=entry['app'],
                function_name=entry['fn'],
                args=entry.get('args', {}),
                operation_type='write' if entry.get('w') else 'read'),
            return_value=entry.get('ret'))
        if entry['app'] == 'AgentUserInterface' and entry[
                'fn'] == 'send_message_to_user':
            boundary = True
    # The daemon never hands in a final turn without an AUI boundary, even
    # if its app mutations alone would match. A missing reply must fail.
    judgment = None
    if boundary and oracle[0]:
        events = []
        for event in sorted(completed.values(), key=lambda e: e.event_time):
            if event.event_type not in ('AGENT', 'ENV'):
                continue
            events.append(event)
            if event.action.function_name == 'send_message_to_user':
                break

        def engine(messages, **kwargs):
            response = asyncio.run(judge_completion(messages))  # noqa: F821
            return response, {}

        judge = Judge(  # noqa: F821 - port.py
            oracle,
            graph,
            tasks,
            user_details=user,
            start_time=loader.start_time,
            engine=engine,
            app_name_to_class=loader.app_name_to_class,
            state_dir='/output')
        judgment = judge.judge_turn(0, events)
    success = judgment is not None and judgment.success
    reason = (judgment.failure_reason
              or None) if judgment else 'no final judgment'
    return {
        'success': success,
        'failure_reason': reason,
        'reply': reply,
        'app_calls': calls,
        'reward': 1.0 if success else 0.0
    }


details = evaluate_gaia2(json.loads(Path('/input/state.json').read_text()))
Path('/output/reward_details.json').write_text(json.dumps(details))
