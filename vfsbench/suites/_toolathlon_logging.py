"""Run the original VFS-Bench Cloud Logging store in a private directory."""

import asyncio
import json
from contextlib import contextmanager
from datetime import UTC, datetime

from ._toolathlon_bigquery import PROJECT
from .vendor.cloud_logging import logging_store as store

TASKS = {'ab-testing', 'academic-warning', 'live-transactions'}


def schema(properties, required=()):
    return {
        'inputSchema': {
            'type': 'object',
            'properties': properties,
            'required': list(required),
            'additionalProperties': False
        }
    }


class Logging:
    tools = {
        'logging_list_logs':
        schema({}),
        'logging_read_logs':
        schema({
            'log_filter': {
                'type': 'string'
            },
            'max_entries': {
                'type': 'integer',
                'minimum': 0
            }
        }),
        'logging_write_log':
        schema(
            {
                'log_name': {
                    'type': 'string'
                },
                'message': {
                    'type': 'string'
                },
                'severity': {
                    'type': 'string'
                }
            }, ('log_name', 'message')),
        'logging_delete_log':
        schema({'log_name': {
            'type': 'string'
        }}, ('log_name', )),
    }

    def __init__(self, task, root):
        from .toolathlon import _read
        self.root = root
        self.launch_time = datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S %A')
        manifest = json.loads(_read(task, 'shared/logging.json'))
        expected = {
            'project': PROJECT,
            'buckets': [{
                'name_file':
                'groundtruth_workspace/log_bucket_name.txt'
            }]
        }
        if manifest != expected:
            raise ValueError('Unexpected Cloud Logging seed')
        bucket = _read(task,
                       'upstream/groundtruth_workspace/log_bucket_name.txt'
                       ).decode().strip()
        with self.scope():
            store.put_bucket(
                f'projects/{PROJECT}/locations/global/buckets/{bucket}', {
                    'retention_days': 30,
                    'description': ''
                })

    @contextmanager
    def scope(self):
        token = store.ROOT_OVERRIDE.set(str(self.root))
        try:
            yield
        finally:
            store.ROOT_OVERRIDE.reset(token)

    def call(self, name, args):
        with self.scope():
            if name == 'logging_list_logs':
                return '\n'.join(
                    sorted({key.rsplit('/', 1)[-1]
                            for key in store.buckets()} | {
                                row['logName'].rsplit('/', 1)[-1]
                                for row in store.read()
                            }))
            if name == 'logging_read_logs':
                return json.dumps(
                    store.select(args.get('log_filter'), 'timestamp desc',
                                 args.get('max_entries', 50)))
            log = 'projects/' + PROJECT + '/logs/' + args['log_name']
            if name == 'logging_delete_log':
                return f'Deleted {store.delete_log(log)} log entries'
            level = args.get('severity', 'INFO').upper()
            if level not in store.SEVERITIES:
                raise ValueError('Unknown Cloud Logging severity')
            store.write([{
                'textPayload': args['message'],
                'logName': log,
                'severity': level,
                'resource': {
                    'type': 'global',
                    'labels': {
                        'project_id': PROJECT
                    }
                }
            }])
            return f'Wrote {level} entry to {log}'

    async def state(self):
        with self.scope():
            return {
                'buckets': store.buckets(),
                'entries': store.read(),
                'launch_time': self.launch_time
            }


async def freeze(view):
    """Stage the original store so the upstream grader can run its own
    filters offline."""
    from pathlib import Path
    snapshot = await view.service_state('logging')
    if snapshot['entries']:
        # These upstream verifiers truncate eval_time to the second. Let that
        # upper bound advance past the most recent committed subsecond write.
        last = max(
            datetime.fromisoformat(row['timestamp']).timestamp()
            for row in snapshot['entries'])
        delay = int(last) + 1 - datetime.now(UTC).timestamp()
        if delay > 0:
            await asyncio.sleep(delay)
    original = Path(store.__file__)
    return {
        'logging.json':
        json.dumps(snapshot).encode(),
        'code/logging_store.py':
        original.read_bytes(),
        'frozen-logging/buckets.json':
        json.dumps(snapshot['buckets']).encode(),
        'frozen-logging/entries.jsonl':
        ''.join(json.dumps(row) + '\n'
                for row in snapshot['entries']).encode()
    }
