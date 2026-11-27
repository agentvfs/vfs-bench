"""Run VFS-Bench 1's pinned BigQuery emulator with a private container per
trial."""

import ast
import asyncio
import csv
import io
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from http.client import HTTPResponse
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from mcp import types

from ._mcpatlas_services import tool_cli

IMAGE = ('ghcr.io/goccy/bigquery-emulator:0.8.1@sha256:'
         'f4e428d265a93dc5ce36c294e1c584c7c9b384117d47ab8ddbb63d8d50b7f393')
PROJECT = 'mcp-bench0606'
BASE = f'/bigquery/v2/projects/{PROJECT}'
WAREHOUSES = {
    'ab-testing': 'ab_testing',
    'academic-warning': 'academic_warning',
    'live-transactions': 'transactions_analytics'
}
TASKS = {
    'flagged-transactions', 'price-comparison', 'game-statistics',
    'machine-operating', *WAREHOUSES
}
PRICING_DATASET = 'bigquery_pricing_analysis'
# A static container-local transport. All request data, including SQL, goes
# through stdin, never into a shell word. The container has no network device
# beyond loopback, no published ports and no access to the Docker socket.
BRIDGE = 'exec 3<>/dev/tcp/127.0.0.1/9050; cat >&3; cat <&3'
TOOLS = {
    'bigquery_list_datasets': {
        'inputSchema': {
            'type': 'object',
            'properties': {},
            'additionalProperties': False
        }
    },
    'bigquery_get_dataset_info': {
        'inputSchema': {
            'type': 'object',
            'properties': {
                'dataset_id': {
                    'type': 'string'
                }
            },
            'required': ['dataset_id'],
            'additionalProperties': False
        }
    },
    'bigquery_run_query': {
        'inputSchema': {
            'type': 'object',
            'properties': {
                'query': {
                    'type': 'string'
                },
                'dry_run': {
                    'type': 'boolean',
                    'default': False
                },
                'max_results': {
                    'type': 'integer',
                    'minimum': 1,
                    'default': 1000
                }
            },
            'required': ['query'],
            'additionalProperties': False
        }
    },
}


async def _docker(*args, body=None, timeout=120):
    proc = await asyncio.create_subprocess_exec(
        'docker',
        *args,
        stdin=asyncio.subprocess.PIPE
        if body is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    try:
        async with asyncio.timeout(timeout):
            output, error = await proc.communicate(body)
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    if proc.returncode:
        raise RuntimeError('BigQuery container: ' +
                           error.decode(errors='replace')[-1000:])
    return output


class _ResponseBuffer:

    def __init__(self, data):
        self.data = data

    def makefile(self, *_args):
        return io.BytesIO(self.data)


async def request_bytes(container,
                        port,
                        method,
                        path,
                        body=b'',
                        content_type='application/json'):
    bridge = {9050: BRIDGE, 4443: BRIDGE.replace('9050', '4443')}[port]
    wire = (
        f'{method} {path} HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n'
        f'Content-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n'
    ).encode() + body
    response = HTTPResponse(
        _ResponseBuffer(await _docker('exec',
                                      '-i',
                                      container,
                                      'bash',
                                      '-c',
                                      bridge,
                                      body=wire)))
    response.begin()
    data = response.read()
    if response.status >= 400:
        raise ValueError(f'Google Cloud emulator returned {response.status}: '
                         f'{data.decode(errors="replace")[:500]}')
    return data


class BigQuery:

    def __init__(self, name, task_id, launch_date, reads):
        self.name = name
        self.task_id = task_id
        self.launch_date = launch_date
        self.reads = reads
        self.storage = None
        self.logging = None

    async def request(self, path, document=None):
        method = 'POST' if document is not None else 'GET'
        body = json.dumps(document).encode() if document is not None else b''
        data = await request_bytes(self.name, 9050, method, BASE + path, body)
        return json.loads(data)

    async def query(self, sql, *, dry_run=False, limit=1000):
        result = await self.request(
            '/queries', {
                'query': sql,
                'useLegacySql': False,
                'dryRun': dry_run,
                'maxResults': limit
            })
        if result.get('errors'):
            raise ValueError(result['errors'][0]['message'])
        return result

    async def call_tool(self, name, arguments):
        try:
            if name.startswith('storage_') and self.storage is not None:
                answer = await self.storage.call(name, arguments)
            elif name.startswith('logging_') and self.logging is not None:
                answer = self.logging.call(name, arguments)
            elif name == 'bigquery_list_datasets':
                listing = await self.request('/datasets')
                answer = '\n'.join('- ' + item['datasetReference']['datasetId']
                                   for item in listing.get('datasets', []))
            elif name == 'bigquery_get_dataset_info':
                path = '/datasets/' + quote(arguments['dataset_id'], safe='')
                info = await self.request(path)
                info['tables'] = [
                    row['tableReference']['tableId'] for row in (
                        await self.request(path +
                                           '/tables')).get('tables', [])
                ]
                answer = json.dumps(info)
            else:
                result = await self.query(
                    arguments['query'],
                    dry_run=arguments.get('dry_run', False),
                    limit=arguments.get('max_results', 1000))
                answer = 'Total rows: ' + str(result.get('totalRows', 0))
                for index, row in enumerate(_rows(result)[:5], 1):
                    answer += f'\nRow {index}: {row}'
            failed = False
        except (ValueError, FileNotFoundError) as exc:
            answer, failed = str(exc), True
        return types.CallToolResult(
            content=[types.TextContent(type='text', text=answer)],
            isError=failed)

    async def state(self):
        if self.task_id == 'flagged-transactions':
            return await self.query(
                'SELECT * FROM `all_transactions.recordings`', limit=100000)
        if self.task_id == 'machine-operating':
            return await self.query(
                'SELECT * FROM `machine_operating.live_sensor`', limit=100000)
        if self.task_id in WAREHOUSES:
            path = '/datasets/' + WAREHOUSES[self.task_id]
            tables = {}
            for row in (await
                        self.request(path + '/tables')).get('tables', []):
                name = row['tableReference']['tableId']
                base = path + '/tables/' + quote(name, safe='')
                item = await self.request(base)
                rows = []
                cursor = ''
                while True:
                    page = await self.request(base + '/data?maxResults=10000' +
                                              cursor)
                    rows.extend(
                        _record(item['schema']['fields'], row)
                        for row in page.get('rows', []))
                    if not page.get('pageToken'):
                        break
                    cursor = '&pageToken=' + quote(page['pageToken'], safe='')
                tables[name] = {'metadata': item, 'rows': rows}
            return {'dataset': WAREHOUSES[self.task_id], 'tables': tables}
        # Freeze the same metadata and SQL reads as the original verifier.
        # Its SDK can replay those reads in a disconnected guest.
        listing = await self.request('/datasets')
        datasets = [
            entry['datasetReference']['datasetId']
            for entry in listing.get('datasets', [])
        ]
        dataset = ('game_analytics'
                   if self.task_id == 'game-statistics' else PRICING_DATASET)
        state = {
            'task_id': self.task_id,
            'datasets': datasets,
            'tables': {},
            'queries': {},
            'launch_date': self.launch_date
        }
        if dataset not in datasets:
            return state
        path = '/datasets/' + dataset + '/tables'
        tables = await self.request(path)
        for table in tables.get('tables', []):
            name = table['tableReference']['tableId']
            state['tables'][dataset + '.' +
                            name] = await self.request(path + '/' +
                                                       quote(name, safe=''))
        for sql in self.reads:
            try:
                result = await self.query(sql, limit=10000)
                fields = result.get('schema', {}).get('fields', [])
                rows = _rows(result)
                while result.get('pageToken'):
                    ref = result['jobReference']
                    result = await self.request(
                        '/queries/' + quote(ref['jobId'], safe='') +
                        '?pageToken=' + quote(result['pageToken'], safe=''))
                    rows.extend(_rows(result))
                state['queries'][sql] = {'rows': rows, 'schema': fields}
            except ValueError as exc:
                state['queries'][sql] = {'error': str(exc)}
        return state

    async def install(self, workspace):
        tools = TOOLS
        if self.storage is not None:
            self.storage.workspace = workspace
            tools = {**TOOLS, **self.storage.tools}
        if self.logging is not None:
            tools = {**tools, **self.logging.tools}
        workspace.register_cli('google-cloud',
                               tool_cli('google-cloud', self, tools, tools))


def _rows(result):
    fields = result.get('schema', {}).get('fields', [])
    return [_record(fields, row) for row in result.get('rows', [])]


def _record(fields, row):
    return {
        field['name']: _value(field, cell['v'])
        for field, cell in zip(fields, row['f'])
    }


def _value(field, value):
    if value is None:
        return None
    if field.get('mode') == 'REPEATED':
        item = {**field, 'mode': 'NULLABLE'}
        return [_value(item, cell['v']) for cell in value]
    kind = field['type']
    if kind in {'RECORD', 'STRUCT'}:
        return _record(field['fields'], value)
    if kind in {'INTEGER', 'INT64'}:
        return int(value)
    if kind in {'FLOAT', 'FLOAT64'}:
        return float(value)
    if kind in {'BOOL', 'BOOLEAN'}:
        return str(value).lower() == 'true'
    if kind == 'TIMESTAMP':
        return datetime.fromtimestamp(float(value), UTC).isoformat()
    return value


def _verifier_reads(task, day):
    """Extract only SELECT string literals with named placeholders from the
    hash-pinned grader."""
    if task.id not in {'price-comparison', 'game-statistics'}:
        return []
    from .toolathlon import _read
    is_game = task.id == 'game-statistics'
    names = {
        'today_str': day,
        'table_name':
        'leaderboard_' + day.replace('-', '') if is_game else 'analysis',
        'dataset_name': 'game_analytics' if is_game else PRICING_DATASET
    }
    queries = []
    for node in ast.walk(ast.parse(_read(task,
                                         'upstream/evaluation/main.py'))):
        if not isinstance(node, ast.Assign) or not isinstance(
                node.value, ast.JoinedStr):
            continue
        items = node.value.values
        if not isinstance(
                items[0],
                ast.Constant) or not items[0].value.lstrip().startswith(
                    ('SELECT ', 'SELECT\n', 'WITH ')):
            continue
        parts = []
        for item in items:
            if isinstance(item, ast.Constant):
                parts.append(item.value)
            elif isinstance(item, ast.FormattedValue) and isinstance(
                    item.value, ast.Name):
                parts.append(names[item.value.id])
            else:
                raise ValueError(
                    'Unrecognized SQL in the pinned BigQuery verifier')
        queries.append(' '.join(''.join(parts).split()))
    if len(queries) != (5 if is_game else 2):
        raise ValueError(
            'Unexpected query inventory in the pinned BigQuery verifier')
    return queries


async def _load_game(service, task, config):
    from ..runtime import VerifierGuest
    from .toolathlon import _read
    generator = Path(__file__).with_name('_toolathlon_game_seed.py')
    files = {
        'collect.py': generator.read_bytes(),
        'preprocess.py': _read(task, 'upstream/preprocess/main.py')
    }
    async with VerifierGuest(config) as guest:
        generated = await guest.run(
            files, ['python3', '-I', 'collect.py', service.launch_date])
    if generated.return_code:
        raise RuntimeError('Toolathlon game generator failed: ' +
                           generated.stderr[-1500:])
    tables = json.loads(generated.stdout)
    expected = {'daily_scores_stream': 1314, 'player_historical_stats': 1000}
    if {
            name: len(table['rows'])
            for name, table in tables.items()
    } != expected:
        raise ValueError(
            'Unexpected table sizes from Toolathlon game generator')
    for name, table in tables.items():
        path = '/datasets/game_analytics/tables'
        metadata = {
            'tableReference': {
                'projectId': PROJECT,
                'datasetId': 'game_analytics',
                'tableId': name
            },
            'schema': {
                'fields': table['schema']
            }
        }
        if name == 'daily_scores_stream':
            metadata['timePartitioning'] = {
                'type': 'DAY',
                'field': 'timestamp'
            }
        await service.request(path, metadata)
        rows = table['rows']
        for start in range(0, len(rows), 250):
            result = await service.request(
                path + '/' + name + '/insertAll',
                {'rows': [{
                    'json': row
                } for row in rows[start:start + 250]]})
            if result.get('insertErrors'):
                raise ValueError(f'Failed to seed game table {name}: '
                                 f'{result["insertErrors"][:1]}')
        count = await service.query(
            f'SELECT COUNT(*) AS n FROM `game_analytics.{name}`')
        if _rows(count) != [{'n': expected[name]}]:
            raise ValueError(f'Incomplete game table {name}')


def _seed(task, path):
    from .toolathlon import _read
    if task.id in WAREHOUSES:
        from .vendor.cloud_logging.csv_types import column_type, typed
        config = json.loads(_read(task, 'shared/bigquery.json'))
        tables = []
        for spec in config['tables']:
            if config['project'] != PROJECT or spec['dataset'] != WAREHOUSES[
                    task.id]:
                raise ValueError('Unexpected warehouse fixture')
            data = _read(task, 'upstream/' + spec['csv']).decode('utf-8-sig')
            reader = csv.DictReader(io.StringIO(data, newline=''))
            rows = list(reader)
            kinds = {
                key: column_type([r[key] for r in rows if r[key]])
                for key in reader.fieldnames
            }
            tables.append({
                'id':
                spec['table'],
                'columns': [{
                    'name': k,
                    'type': t
                } for k, t in kinds.items()],
                'data': [{
                    k: typed(r[k], t)
                    for k, t in kinds.items()
                } for r in rows]
            })
        datasets = [{'id': WAREHOUSES[task.id], 'tables': tables}]
    elif task.id == 'game-statistics':
        config = json.loads(_read(task, 'shared/bigquery.json'))
        if config != {
                'project': PROJECT,
                'preprocess': 'tasks.finalpool.game-statistics.preprocess.main'
        }:
            raise ValueError('Unexpected game warehouse fixture')
        datasets = [{'id': 'game_analytics', 'tables': []}]
    elif task.id == 'price-comparison':
        config = json.loads(_read(task, 'shared/bigquery.json'))
        if config != {'project': PROJECT, 'datasets': [PRICING_DATASET]}:
            raise ValueError('Unexpected pricing warehouse fixture')
        datasets = [{'id': PRICING_DATASET, 'tables': []}]
    else:
        if task.id == 'machine-operating':
            config = json.loads(_read(task, 'shared/bigquery.json'))
            expected = {
                'dataset': 'machine_operating',
                'table': 'live_sensor',
                'csv': 'preprocess/live_sensor_data.csv',
                'types': {
                    'timestamp': 'STRING'
                }
            }
            if config != {'project': PROJECT, 'tables': [expected]}:
                raise ValueError('Unexpected machine warehouse fixture')
            data = _read(task, 'upstream/preprocess/live_sensor_data.csv')
            dataset, table = 'machine_operating', 'live_sensor'
            numeric = 'reading'
        else:
            data = _read(task, 'upstream/files/all_transactions.csv')
            dataset, table = 'all_transactions', 'recordings'
            numeric = 'amount'
        datasets = [{
            'id': dataset,
            'tables': [_csv_table(data, table, numeric)]
        }]
    path.write_text(json.dumps(
        {'projects': [{
            'id': PROJECT,
            'datasets': datasets
        }]}),
                    encoding='utf8')


def _csv_table(data, name, numeric):
    with io.StringIO(data.decode('utf-8-sig'), newline='') as stream:
        reader = csv.DictReader(stream)
        names = reader.fieldnames
        rows = []
        for row in reader:
            row[numeric] = float(row[numeric]) if row[numeric] else None
            rows.append({
                key: value if value != '' else None
                for key, value in row.items()
            })
    columns = [{
        'name': key,
        'type': 'FLOAT64' if key == numeric else 'STRING'
    } for key in names]
    return {'id': name, 'columns': columns, 'data': rows}


@asynccontextmanager
async def serve(task, run_dir, config, *, empty_dataset=None):
    seed = run_dir / 'bigquery.yaml'
    if empty_dataset is None:
        await asyncio.to_thread(_seed, task, seed)
    else:
        seed.write_text(
            json.dumps({
                'projects': [{
                    'id': PROJECT,
                    'datasets': [{
                        'id': empty_dataset
                    }]
                }]
            }))
    name = 'vfsbench-bigquery-' + uuid4().hex
    day = datetime.now(UTC).date().isoformat()
    reads = await asyncio.to_thread(_verifier_reads, task, day)
    service = BigQuery(name, task.id, day, reads)
    try:
        await _docker(
            'run', '--detach', '--name', name, '--network', 'none',
            '--read-only', '--cap-drop', 'ALL', '--security-opt',
            'no-new-privileges', '--tmpfs', '/tmp', '--mount',
            f'type=bind,src={seed},dst=/fixture.yaml,readonly', '--pull',
            'never' if task._dataset._local_files_only else 'missing', IMAGE,
            f'--project={PROJECT}', '--data-from-yaml=/fixture.yaml')
        async with asyncio.timeout(90):
            while True:
                try:
                    await service.request('/datasets')
                    break
                except (RuntimeError, OSError, ValueError):
                    running = await _docker('inspect', '--format',
                                            '{{.State.Running}}', name)
                    if running.strip() != b'true':
                        log = await _docker('logs', name)
                        raise RuntimeError(
                            'BigQuery emulator failed to start: ' +
                            log.decode(errors='replace')[-1000:])
                    await asyncio.sleep(0.3)
        if task.id == 'game-statistics':
            await _load_game(service, task, config)
        yield service
    finally:
        try:
            await _docker('rm', '--force', name)
        except RuntimeError as exc:
            if 'No such container' not in str(exc):
                raise
