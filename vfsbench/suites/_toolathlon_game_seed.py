"""Run the original game generator inside an offline microVM and collect its
Google SDK writes."""

import json
import runpy
import sys
from contextlib import redirect_stdout
from datetime import date
from types import ModuleType, SimpleNamespace

import numpy


def module(name):
    result = ModuleType(name)
    sys.modules[name] = result
    return result


def field(name, field_type, mode='NULLABLE', fields=(), **metadata):
    value = {'name': name, 'type': field_type, 'mode': mode, **metadata}
    if fields:
        value['fields'] = list(fields)
    return value


class Table:

    def __init__(self, name, schema):
        self.table_id = name.rsplit('.', 1)[-1]
        self.schema = schema
        self.rows = []


class SeedClient:

    def __init__(self):
        self.tables = {}

    def list_datasets(self):
        return [SimpleNamespace(dataset_id='game_analytics')]

    def list_tables(self, dataset):
        return self.tables.values()

    def get_dataset(self, name):
        return SimpleNamespace(dataset_id=name)

    def get_table(self, name):
        return self.tables[name.rsplit('.', 1)[-1]]

    def create_table(self, table):
        self.tables[table.table_id] = table

    def load_table_from_json(self, rows, table, job_config):
        table.rows = rows
        return SimpleNamespace(job_id='fixture-load', result=lambda: None)

    def query(self, sql):
        # These two calls only log post-load summaries. Generate those from the
        # recorded rows; the controller subsequently checks the emulator
        # counts.
        if 'daily_scores_stream' in sql:
            rows = self.tables['daily_scores_stream'].rows
            summary = dict(total_rows=len(rows),
                           unique_players=len(
                               {row['player_id']
                                for row in rows}),
                           data_date=rows[0]['timestamp'][:10])
        elif 'player_historical_stats' in sql:
            rows = self.tables['player_historical_stats'].rows
            days = {row['date'] for row in rows}
            summary = dict(total_rows=len(rows),
                           unique_dates=len(days),
                           earliest_date=min(days),
                           latest_date=max(days))
        else:
            raise ValueError('Unexpected game generator query')
        return SimpleNamespace(result=lambda: [SimpleNamespace(**summary)])


def main():
    helper = module('utils.general.helper')
    # The pinned generator imports these unused helpers.
    helper.run_command = helper.get_module_path = None
    client = SeedClient()
    sdk = module('google.cloud.bigquery')
    module('google.cloud').bigquery = sdk
    sdk.Client = lambda **credentials: client
    sdk.Table, sdk.SchemaField = Table, field
    sdk.TimePartitioning = sdk.LoadJobConfig = SimpleNamespace
    sdk.TimePartitioningType = SimpleNamespace(DAY='DAY')
    sdk.SourceFormat = SimpleNamespace(
        NEWLINE_DELIMITED_JSON='NEWLINE_DELIMITED_JSON')
    auth = module('google.oauth2.service_account')
    auth.Credentials = SimpleNamespace(
        from_service_account_file=lambda path: None)
    module('google.oauth2').service_account = auth
    errors = module('google.api_core.exceptions')
    errors.Conflict = KeyError
    errors.GoogleAPICallError = OSError
    errors.NotFound = LookupError
    numpy.random.seed(42)  # Same complementary NumPy seed as VFS-Bench 1.
    with redirect_stdout(sys.stderr):
        original = runpy.run_path('preprocess.py')
        original['setup_bigquery_resources']('', 'mcp-bench0606',
                                             date.fromisoformat(sys.argv[1]))
    print(
        json.dumps(
            {
                name: {
                    'schema': table.schema,
                    'rows': table.rows
                }
                for name, table in client.tables.items()
            },
            separators=(',', ':')))


if __name__ == '__main__':
    main()
