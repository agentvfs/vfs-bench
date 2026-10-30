"""Differential GAIA2 audit: unchanged CPython judge vs Mirage/Monty.

Run with the gaia2 project's Python after setup.py. Uses synthetic oracle
events and mutations over every configured scenario; no paid model calls.
Full agent/fake integration is tested separately with Harbor oracle trials.
"""
import argparse
import base64
import copy
import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

import gaia2_cli.judge
from gaia2_cli.daemon.eventd import Gaia2EventDaemon
from gaia2_core.event_loop.processor import EventProcessor
from gaia2_core.judge.config import build_checker_registries
from gaia2_core.loader import ScenarioLoader

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent


def oracle_state(scenario):
    loader = ScenarioLoader(str(scenario))
    processor = EventProcessor(loader.events,
                               start_time=loader.start_time,
                               time_increment=loader.time_increment,
                               app_name_to_class=loader.app_name_to_class)
    processor.build_event_id_to_turn_idx()
    oracle = loader.extract_oracle_data(processor.event_id_to_turn_idx,
                                        processor.nb_turns)[0][0]
    rows = []
    reply = 'Done'
    returns = {e.event_id: 'created-id' for e in oracle}
    for event in oracle:
        for value in event.args.values():
            match = re.fullmatch(r'\{\{(.*?)\}\}',
                                 value.strip()) if isinstance(value,
                                                              str) else None
            if match and '.' in match[1]:
                eid, *keys = match[1].split('.')
                if not isinstance(returns.get(eid), dict):
                    returns[eid] = {}
                target = returns[eid]
                for key in keys[:-1]:
                    target = target.setdefault(key, {})
                target[keys[-1]] = 'created-id'
    for index, event in enumerate(oracle):
        if event.action.function_name == 'send_message_to_user':
            reply = event.args.get('content', '')
            continue
        # Give every oracle return the same deterministic value. The same
        # placeholder in later oracle and agent arguments then resolves to it.
        args = {}
        for key, value in event.args.items():
            match = re.fullmatch(r'\{\{(.*?)\}\}',
                                 value.strip()) if isinstance(value,
                                                              str) else None
            resolved = value
            if match:
                eid, *keys = match[1].split('.')
                resolved = returns.get(eid, value)
                for field in keys:
                    resolved = resolved.get(field, value) if isinstance(
                        resolved, dict) else value
            args[key] = resolved
        entry = {
            't': loader.start_time,
            'app': event.action.class_name,
            'fn': event.action.function_name,
            'args': args,
            'w': True,
            'ret': returns[event.event_id],
            'event_id': f'agent-{index}'
        }
        rows.append({'wall': index, 'seq': index, 'entry': json.dumps(entry)})
    contacts = next(
        (a.get('app_state', {}) for a in loader._data['apps']
         if a.get('class_name') in ('ContactsApp', 'InternalContacts')), {})
    return {
        'states': {
            'gaia2_contacts': {
                'event': rows,
                'doc': [{
                    'name': 'state',
                    'doc': json.dumps(contacts)
                }]
            }
        },
        'trajectory': {
            'steps': [] if reply is None else [{
                'source': 'agent',
                'message': reply
            }]
        }
    }


def reference(scenario, state, response):
    calls = []

    def factory(*args, **kwargs):

        def engine(messages, **kwargs):
            calls.append({'messages': messages, 'reply': response})
            return response, {}

        return engine

    gaia2_cli.judge.create_litellm_engine = factory
    os.environ['GAIA2_JUDGE_FINAL_TURN'] = '1'
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        entries = []
        for service, tables in state['states'].items():
            entries += [(r['wall'], r['seq'], r['entry'])
                        for r in tables['event']]
            if service == 'gaia2_contacts':
                for row in tables['doc']:
                    if row['name'] == 'state':
                        (directory / 'contacts.json').write_text(row['doc'])
        lines = [json.loads(e) for _, _, e in sorted(entries)]
        # Keep this extraction independent from the candidate adapter.
        reply = None
        for step in reversed(state['trajectory'].get('steps', [])):
            if step.get('source') == 'agent':
                value = step.get('message')
                if isinstance(value, list):
                    value = '\n'.join(
                        p.get('text', '') for p in value
                        if p.get('type') == 'text')
                if isinstance(value, str) and value.strip():
                    reply = value
                    break
        if reply is not None:
            start = json.loads(
                scenario.read_text())['metadata']['definition']['start_time']
            lines.append({
                't': start,
                'app': 'AgentUserInterface',
                'fn': 'send_message_to_user',
                'args': {
                    'content': reply
                },
                'w': True,
                'ret': None
            })
        (directory / 'events.jsonl').write_text(''.join(
            json.dumps(e) + '\n' for e in lines))
        daemon = Gaia2EventDaemon(str(scenario),
                                  str(directory),
                                  judge_model='recorded',
                                  poll_interval=0.001,
                                  idle_timeout=0.01)
        daemon.setup()
        # The snapshot is complete. Feed it through the original daemon's
        # parser and original processor's final-turn collection directly,
        # avoiding its wall-clock polling loop in this differential audit.
        daemon._add_events_to_processor(lines)
        result = daemon._processor.judge_final_turn() if any(
            e.get('app') == 'AgentUserInterface'
            and e.get('fn') == 'send_message_to_user' for e in lines) else None
        logged = directory / 'judgments.jsonl'
        order = [
            e['id'] for e in json.loads(logged.read_text().splitlines()[-1])
            ['oracle_events']
        ] if logged.exists() else None
        return int(result is not None and result.success), calls, order


def cases(state):
    yield 'oracle', state, None
    yield 'nop', {'states': {}, 'trajectory': {}}, None
    wrong = copy.deepcopy(state)
    wrong['trajectory'] = {
        'steps': [{
            'source': 'agent',
            'message': 'a deliberately different answer'
        }]
    }
    yield 'wrong-no-judge', wrong, None
    yield 'wrong-accepted', wrong, '[[Success]] [[True]]'
    yield 'wrong-rejected', wrong, '[[Failure]] [[False]]'
    rows = wrong['states']['gaia2_contacts']['event']
    if rows:
        partial = copy.deepcopy(state)
        partial['states']['gaia2_contacts']['event'].pop(0)
        yield 'missing-write', partial, None
        extra = copy.deepcopy(state)
        extra['states']['gaia2_contacts']['event'].append(
            copy.deepcopy(rows[0]))
        # Distinct ids: upstream otherwise replaces the duplicate event.
        e = json.loads(extra['states']['gaia2_contacts']['event'][-1]['entry'])
        e['event_id'] = 'extra-write'
        extra['states']['gaia2_contacts']['event'][-1]['entry'] = json.dumps(e)
        yield 'extra-write', extra, None
        reworded = copy.deepcopy(state)
        registry = build_checker_registries()[0]
        changed = False
        for row in reworded['states']['gaia2_contacts']['event']:
            event = json.loads(row['entry'])
            checks = registry.get(event['app'] + '__' + event['fn'], {})
            for name, checker in checks.items():
                if checker.value == 'llm_checker' and event['args'].get(name):
                    event['args'][
                        name] = 'Reworded content for judge comparison'
                    changed = True
            row['entry'] = json.dumps(event)
        if changed:
            yield 'reworded-no-judge', reworded, None
            yield 'reworded-accepted', reworded, '[[Success]] [[True]]'
            yield 'reworded-rejected', reworded, '[[Failure]] [[False]]'


def main():
    logging.getLogger().setLevel(logging.CRITICAL)
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--task', action='append')
    parser.add_argument('--node', default='node')
    parser.add_argument(
        '--live-mock',
        action='store_true',
        help='Compare default native ordering with a local HTTP judge')
    parser.add_argument('--out',
                        type=Path,
                        default=ROOT / 'state/harbor/gaia2-parity.json')
    args = parser.parse_args()
    manifest = json.loads((HARBOR / 'graders/gaia2/manifest.json').read_text())
    driver = HARBOR / 'graders/gaia2/audit-driver.ts'
    report = []
    with subprocess.Popen([args.node, str(driver)],
                          cwd=ROOT,
                          stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE,
                          text=True,
                          env={
                              **os.environ, 'GAIA2_AUDIT_HTTP':
                              '1' if args.live_mock else ''
                          }) as worker:
        for task in args.task or manifest['tasks']:
            split, number = task.split('-')
            scenario = next((ROOT / 'state/gaia2/scenarios' /
                             split).glob(f'{number}_*.json'))
            encoded = base64.b64encode(scenario.read_bytes()).decode()
            for name, state, response in cases(oracle_state(scenario)):
                expected, calls, order = reference(scenario, state, response)
                frozen = state if args.live_mock else {
                    **state,
                    **({
                        'oracle_order': order
                    } if order is not None else {})
                }
                request = {
                    'task': task,
                    'timeoutSeconds': 30,
                    **({
                        'auditResponse': response
                    } if args.live_mock else {
                           'judgeReplay': calls
                       }), 'files': {
                        '/input/scenario.json':
                        encoded,
                        '/input/state.json':
                        base64.b64encode(json.dumps(frozen).encode()).decode()
                    }
                }
                worker.stdin.write(json.dumps(request) + '\n')
                worker.stdin.flush()
                actual = json.loads(worker.stdout.readline())
                row = {
                    'task': task,
                    'case': name,
                    'reference': expected,
                    **actual
                }
                report.append(row)
                if actual.get('score') != expected:
                    print(json.dumps(row), flush=True)
            print(f'{task}: {len(report)} comparisons', flush=True)
        worker.stdin.close()
        worker.wait()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    failed = [r for r in report if r.get('score') != r['reference']]
    print(f'{len(report)} comparisons, {len(failed)} differences: {args.out}')
    return bool(failed)


if __name__ == '__main__':
    raise SystemExit(main())
