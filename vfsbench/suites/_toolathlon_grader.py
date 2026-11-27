"""Run inside the isolated verifier VM, with the frozen inputs under
/grading."""

import base64
import importlib
import json
import re
import runpy
import sys
from datetime import date, datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace


def module(name):
    return sys.modules.setdefault(name, ModuleType(name))


def google_sheet_snapshot():
    import pandas as pd

    module('gspread')
    module('googleapiclient.discovery').build = None
    snapshot = json.loads(Path('sheet.json').read_bytes())
    drive = module('utils.app_specific.googlesheet.drive_helper')

    def find_spreadsheet(folder, title):
        if folder != snapshot['folder'] or title != snapshot[
                'title'] or not snapshot['rows']:
            raise LookupError('Output spreadsheet missing')
        return 'output'

    def fetch_sheet(_sheet_id):
        rows = snapshot['rows']
        if len(rows) < 2:
            raise ValueError('Spreadsheet contains no data')
        width = max(len(row) for row in rows)
        padded = [row + [''] * (width - len(row)) for row in rows]
        return pd.DataFrame(padded[1:], columns=padded[0]).dropna(how='all')

    drive.find_spreadsheet_in_folder = find_spreadsheet
    drive.fetch_google_sheet_data_gspread = fetch_sheet


def github_snapshot():
    snapshot = json.loads(Path('github.json').read_bytes())
    module('configs.token_key_session'
           ).all_token_key_session = SimpleNamespace(github_token='fixture')
    helper = module('utils.app_specific.github.helper_funcs')
    helper.get_user_name = lambda token: snapshot['owner']

    def read_content(token, repo, name, branch):
        if (repo, branch) != (snapshot['repo'], snapshot['branch']):
            raise LookupError('Repository or branch missing')
        return snapshot['files'][name]

    helper.read_file_content = read_content


def bigquery_snapshot():
    snapshot = json.loads(Path('bigquery.json').read_bytes())
    module('token_key_session').all_token_key_session = SimpleNamespace()
    auth = module('google.oauth2.service_account')
    auth.Credentials = None
    module('google.oauth2').service_account = auth
    module('google.cloud.exceptions').NotFound = LookupError
    bigquery = module('google.cloud.bigquery')
    module('google.cloud').bigquery = bigquery

    class Client:

        def dataset(self, name):
            return SimpleNamespace(name=name,
                                   table=lambda table: f'{name}.{table}')

        def get_dataset(self, ref):
            if ref.name not in snapshot['datasets']:
                raise LookupError(f'Dataset {ref.name} does not exist')
            return ref

        def get_table(self, ref):
            if ref not in snapshot['tables']:
                raise LookupError(f'Table {ref} does not exist')
            fields = snapshot['tables'][ref]['schema']['fields']
            return SimpleNamespace(schema=[
                SimpleNamespace(name=f['name'], field_type=f['type'])
                for f in fields
            ])

        def query(self, sql):
            result = snapshot['queries'][' '.join(sql.split())]
            if 'error' in result:
                raise ValueError(result['error'])

            class Row(dict):
                __getattr__ = dict.__getitem__

            date_fields = [
                f['name'] for f in result['schema'] if f['type'] == 'DATE'
            ]
            records = [Row(row) for row in result['rows']]
            for row in records:
                for key in date_fields:
                    if row[key] is not None:
                        row[key] = date.fromisoformat(row[key])
            return SimpleNamespace(result=lambda: records)

    bigquery.Client = Client


def storage_snapshot():
    snapshot = json.loads(Path('storage.json').read_bytes())['buckets']
    auth = module('google.oauth2.service_account')
    auth.Credentials = SimpleNamespace(
        from_service_account_file=lambda path: SimpleNamespace())
    module('google.oauth2').service_account = auth
    module('google.cloud.exceptions').NotFound = LookupError
    storage = module('google.cloud.storage')
    module('google.cloud').storage = storage

    class Blob:

        def __init__(self, bucket, name):
            self.bucket, self.name = bucket, name

        def exists(self):
            return self.name in snapshot.get(self.bucket,
                                             {}).get('objects', {})

        def data(self):
            return base64.b64decode(
                snapshot[self.bucket]['objects'][self.name]['base64'])

        def download_as_text(self, start=0, end=None):
            data = self.data()
            return data[start:end + 1 if end is not None else None].decode()

        def download_to_filename(self, filename):
            Path(filename).write_bytes(self.data())

    class Bucket:

        def __init__(self, name):
            self.name = name

        def exists(self):
            return self.name in snapshot

        def blob(self, key):
            return Blob(self.name, key)

        def list_blobs(self):
            return [self.blob(key) for key in snapshot[self.name]['objects']]

    storage.Client = lambda **credentials: SimpleNamespace(
        bucket=Bucket, list_buckets=lambda: [Bucket(n) for n in snapshot])


def logging_snapshot():
    import time

    import logging_store as store

    state = json.loads(Path('logging.json').read_bytes())
    store.ROOT_OVERRIDE.set(str(Path('frozen-logging').resolve()))
    auth = module('google.oauth2.service_account')
    auth.Credentials = SimpleNamespace(
        from_service_account_file=lambda path: SimpleNamespace())
    module('google.oauth2').service_account = auth
    exceptions = module('google.api_core.exceptions')
    exceptions.GoogleAPIError = OSError
    module('google.api_core').exceptions = exceptions
    config = module('google.cloud.logging_v2.services.config_service_v2')
    config.ConfigServiceV2Client = lambda **_: SimpleNamespace(
        list_buckets=lambda parent: [
            SimpleNamespace(name=n) for n in store.buckets()
            if n.startswith(parent + '/buckets/')
        ])

    def list_entries(filter_, order_by=None, **_):
        return [
            SimpleNamespace(payload=row.get('jsonPayload',
                                            row.get('textPayload')),
                            timestamp=datetime.fromisoformat(row['timestamp']))
            for row in store.select(filter_, order_by)
        ]

    logging = module('google.cloud.logging')
    logging.DESCENDING = 'timestamp desc'
    logging.Client = lambda **_: SimpleNamespace(list_entries=list_entries)
    module('google.cloud').logging = logging

    # The immutable snapshot contains every committed entry. The original
    # grading loop can observe its entire 180 s polling window immediately.
    clock = ModuleType('time')
    vars(clock).update(vars(time))
    tick = time.time()

    def advance(seconds):
        nonlocal tick
        tick += seconds

    clock.sleep, clock.time = advance, lambda: tick
    sys.modules['time'] = clock
    return state['launch_time']


def check_frozen_state(check, **_):
    try:
        return check()
    except Exception as exc:
        return False, str(exc)


def main():
    # Python's isolated mode excludes cwd. Put only controller-supplied grader
    # code on the search path, keeping submitted files in a different
    # directory.
    sys.path.insert(0, str(Path('code').resolve()))
    Path('agent').mkdir(exist_ok=True)
    Path('truth').mkdir(exist_ok=True)
    if Path('directories.json').is_file():
        for directory in json.loads(Path('directories.json').read_bytes()):
            relative = Path(directory)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Invalid submitted directory name')
            (Path('agent') / relative).mkdir(parents=True, exist_ok=True)
    for dependency in json.loads(Path('requirements.json').read_bytes()):
        importlib.import_module(dependency)
    module('utils.evaluation.retry').grade_with_retry = check_frozen_state
    helper = module('utils.general.helper')
    helper.read_jsonl = lambda path: [
        json.loads(line) for line in Path(path).read_text().splitlines()
        if line.strip()
    ]
    helper.read_json = lambda path: json.loads(Path(path).read_bytes())
    helper.normalize_str = lambda value: re.sub(r'[^\w]', '', value).lower(
    ).strip()
    if Path('mail.json').is_file():
        import mail_replay
        mail_replay.install()
    if Path('github.json').is_file():
        github_snapshot()
    if Path('sheet.json').is_file():
        google_sheet_snapshot()
    if Path('storage.json').is_file():
        storage_snapshot()
    sys.argv = [
        'evaluation.main', '--agent_workspace', 'agent',
        '--groundtruth_workspace', 'truth', '--res_log_file', 'trajectory.json'
    ]
    if Path('logging.json').is_file():
        sys.argv.extend(['--launch_time', logging_snapshot()])
    if Path('bigquery.json').is_file():
        bigquery_snapshot()
        state = json.loads(Path('bigquery.json').read_bytes())
        if state['task_id'] == 'game-statistics':
            sys.argv.extend([
                '--launch_time', state['launch_date'], '--credentials_file', ''
            ])
    try:
        runpy.run_module('evaluation.main', run_name='__main__')
    except SystemExit as exc:
        if exc.code == 1:
            return 10  # Upstream rejected the submitted artifact.
        if exc.code not in {None, 0}:
            raise
    return 0


if __name__ == '__main__':
    try:
        result = main()
    except Exception:
        import traceback
        traceback.print_exc()
        result = 70
    sys.exit(result)
