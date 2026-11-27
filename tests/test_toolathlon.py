import ast
import base64
import csv
import io
import json
import os
import shlex
import tarfile
import tempfile
import unittest
from pathlib import Path

from vfsbench.dataset import Toolathlon
from vfsbench.runtime import TrialConfig
from vfsbench.suites import _toolathlon_gws as gws
from vfsbench.suites import toolathlon
from vfsbench.suites.toolathlon_workspace import WORKSPACES


class GoogleWorkspaceMockTest(unittest.IsolatedAsyncioTestCase):

    def test_every_released_task_has_a_fixed_workspace(self):
        from vfsbench import TrialEnvironment

        self.assertEqual(set(WORKSPACES), {task.id for task in Toolathlon()})
        for task_id, defaults in WORKSPACES.items():
            with self.subTest(task=task_id):
                env = defaults.bind(TrialEnvironment({}))
                self.assertEqual(tuple(env.workspace["clis"]), defaults.clis)
                self.assertEqual(env.python, defaults.python)

    def test_application_yaml_cannot_shadow_task_resources(self):
        from vfsbench import TrialEnvironment
        from vfsbench.runtime import _workspace_config

        env = TrialEnvironment({"system_time": "2025-09-15T00:00:00Z"},
                               clis={"google-calendar": object()},
                               mounts={"/woo": object()})
        for setting in ("mounts: {/woo/products: {vfs: ram}}",
                        "mounts: {/workspace: {vfs: ram}}",
                        "mounts: {}\nclis: {google-calendar: {cli: git, "
                        "machine: in_process}}",
                        'mounts: {}\nsystem_time: "2026-01-01T00:00:00Z"'):
            with self.subTest(
                    setting=setting), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / "workspace.yaml"
                path.write_text(setting)
                with self.assertRaisesRegex(ValueError, "Workspace YAML"):
                    _workspace_config(env, root, "test", path)

    async def test_concurrent_processes_keep_output_private(self):
        with tempfile.TemporaryDirectory(
        ) as left, tempfile.TemporaryDirectory() as right:
            async with gws.serve(Path(left)) as a, gws.serve(Path(right)) as b:
                for base in (a, b):
                    self.assertEqual(
                        gws.seed(base, 'NHL-B2B-Analysis', 'NHL 2425 Schedule',
                                 [['team']]), 'f0001')
                result = gws.call(
                    a, '/drive/v3/files', {
                        'name': 'NHL-B2B-Analysis',
                        'mimeType': gws.SHEET,
                        'parents': ['f0001']
                    })
                gws.call(
                    a,
                    '/v4/spreadsheets/' + result['id'] + '/values/Sheet1!A1',
                    {'values': [['a'], ['2']]}, 'PUT')
                self.assertEqual(
                    gws.result_rows(gws.state(a), 'f0001', 'NHL-B2B-Analysis'),
                    [['a'], ['2']])
                self.assertEqual(
                    gws.result_rows(gws.state(b), 'f0001', 'NHL-B2B-Analysis'),
                    [])


@unittest.skipUnless(os.environ.get('VFSBENCH_TEST_SNAPSHOT'),
                     'requires an installed offline microsandbox snapshot')
class ToolathlonTrialTest(unittest.IsolatedAsyncioTestCase):

    async def test_original_graders(self):
        suite = Toolathlon(cache_dir=os.environ.get('VFSBENCH_TEST_CACHE'),
                           local_files_only=True)
        config = TrialConfig(snapshot=os.environ['VFSBENCH_TEST_SNAPSHOT'])
        ids = os.environ.get('VFSBENCH_TEST_TASKS', '').split() or sorted({
            *toolathlon.OUTPUTS, *toolathlon.OUTPUT_TREES, *toolathlon.github.
            FIXTURE_HASHES, *toolathlon.bigquery.TASKS, toolathlon.NHL
        } - set(toolathlon.services.INPUTS))
        for name in ids:
            with self.subTest(task=name):
                task = suite[name]
                async with task.open(config=config) as trial:
                    if name == 'ab-testing':
                        # All file/storage evidence is correct but the original
                        # evaluator requires an empty logging bucket for B
                        # wins.
                        await logging_oracle(self, task, trial)
                        await submit_log(self, trial, 'incorrect A winner')
                    if name == 'machine-operating':
                        # A report present locally, but never uploaded, must
                        # fail.
                        truth = task.file(
                            'upstream/groundtruth_workspace/anomaly_report.csv'
                        )
                        await trial.workspace.vfs.write(
                            '/workspace/anomaly_report.csv',
                            truth.read_bytes())
                    self.assertEqual((await trial.verify()).reward, 0)
                async with task.open(config=config) as trial:
                    if name in toolathlon.cloud_logging.TASKS:
                        await logging_oracle(self, task, trial)
                    elif name == 'flagged-transactions':
                        query = json.dumps({
                            'query':
                            'SELECT COUNT(*) AS n FROM '
                            'all_transactions.recordings'
                        })
                        result = await trial.exec(
                            'google-cloud bigquery-run-query ' +
                            shlex.quote(query))
                        self.assertEqual(result.return_code, 0, result.stderr)
                        self.assertIn('Row 1:', result.stdout)
                        original = next(key for key in toolathlon.INPUTS[name]
                                        if '/groundtruth_workspace/' in key)
                        await trial.workspace.vfs.write(
                            '/workspace/' + toolathlon.OUTPUTS[name],
                            task.file(original).read_bytes())
                    elif name == 'machine-operating':
                        query = (
                            "SELECT COUNT(*) AS n FROM "
                            "machine_operating.live_sensor WHERE "
                            "SUBSTR(timestamp, 12, 8) BETWEEN '11:30:00' AND "
                            "'12:30:00'")
                        result = await trial.exec(
                            'google-cloud bigquery-run-query ' +
                            shlex.quote(json.dumps({'query': query})))
                        self.assertEqual(result.return_code, 0, result.stderr)
                        self.assertIn("{'n': 720}", result.stdout)
                        buckets = await trial.exec(
                            'google-cloud storage-list-buckets')
                        self.assertEqual(buckets.return_code, 0,
                                         buckets.stderr)
                        bucket = buckets.stdout.strip().removeprefix('- ')
                        truth = task.file(
                            'upstream/groundtruth_workspace/anomaly_report.csv'
                        )
                        await trial.workspace.vfs.write(
                            '/workspace/report.csv', truth.read_bytes())
                        args = {
                            'bucket_name': bucket,
                            'source_file_path': '/workspace/report.csv',
                            'destination_blob_name': 'anomaly_report.csv'
                        }
                        result = await trial.exec(
                            'google-cloud storage-upload-file ' +
                            shlex.quote(json.dumps(args)))
                        self.assertEqual(result.return_code, 0,
                                         result.stdout + result.stderr)
                        state = await trial.service_state('storage')
                        uploaded = state['buckets'][bucket]['objects'][
                            'anomaly_report.csv']
                        self.assertEqual(base64.b64decode(uploaded['base64']),
                                         truth.read_bytes())
                    elif name == 'game-statistics':

                        async def run_sql(sql):
                            query = shlex.quote(json.dumps({'query': sql}))
                            result = await trial.exec(
                                'google-cloud bigquery-run-query ' + query)
                            self.assertEqual(result.return_code, 0,
                                             result.stderr + result.stdout)
                            return result.stdout

                        date_text = await run_sql(
                            'SELECT CAST(MIN(DATE(timestamp)) AS STRING) AS '
                            'day '
                            'FROM game_analytics.daily_scores_stream')
                        day = ast.literal_eval(
                            date_text.split('Row 1: ')[1])['day']
                        sample = await run_sql(
                            'SELECT scores, timestamp FROM '
                            'game_analytics.daily_scores_stream LIMIT 1')
                        event = ast.literal_eval(sample.split('Row 1: ')[1])
                        self.assertIsInstance(event['scores']['online_score'],
                                              int)
                        self.assertTrue(event['timestamp'].startswith(day))
                        totals = (
                            'SELECT player_id, SUM(scores.online_score + '
                            'scores.task_score) AS total_score '
                            'FROM game_analytics.daily_scores_stream GROUP '
                            'BY player_id')
                        await run_sql(
                            'CREATE TABLE game_analytics.leaderboard_' +
                            day.replace('-', '') + ' AS '
                            'SELECT *, ROW_NUMBER() OVER (ORDER BY '
                            'total_score DESC) AS rank '
                            f'FROM ({totals}) ORDER BY rank LIMIT 100')
                        await run_sql(
                            'INSERT INTO game_analytics.player_historical_'
                            'stats '
                            '(player_id, player_region, date, '
                            'total_online_score, total_task_score, '
                            'total_score, game_count) SELECT player_id, '
                            'player_region, DATE(timestamp), '
                            'SUM(scores.online_score), '
                            'SUM(scores.task_score), '
                            'SUM(scores.online_score+scores.task_score), '
                            'COUNT(*) '
                            'FROM game_analytics.daily_scores_stream GROUP '
                            'BY player_id, player_region, DATE(timestamp)')
                    elif name == 'price-comparison':
                        truth = task.file(
                            'upstream/groundtruth_workspace/competitive_'
                            'pricing_analysis_ground_truth.csv')
                        rows = list(
                            csv.reader(
                                io.StringIO(
                                    truth.read_text(encoding='utf-8-sig'))))
                        table = '`bigquery_pricing_analysis.analysis`'
                        columns = ', '.join(
                            f'`{key}` {kind}'
                            for key, kind in zip(rows[0], ('STRING', 'FLOAT64',
                                                           'FLOAT64',
                                                           'FLOAT64')))
                        values = ', '.join(
                            '(' + ', '.join([json.dumps(row[0]), *row[1:]]) +
                            ')' for row in rows[1:])
                        for sql in (f'CREATE TABLE {table} ({columns})',
                                    f'INSERT INTO {table} VALUES {values}'):
                            query = shlex.quote(json.dumps({'query': sql}))
                            result = await trial.exec(
                                'google-cloud bigquery-run-query ' + query)
                            self.assertEqual(result.return_code, 0,
                                             result.stdout + result.stderr)
                        self.assertTrue(
                            (await trial.service_state('bigquery'))['tables'])
                    elif name == toolathlon.NHL:
                        # The oracle goes through the same Mirage CLI as an
                        # agent.
                        truth = ('upstream/groundtruth_workspace/standard_'
                                 'answer.csv')
                        rows = list(
                            csv.reader(
                                io.StringIO(
                                    task.file(truth).read_text(
                                        encoding='utf-8-sig'))))
                        new_file = json.dumps({
                            'name': 'NHL-B2B-Analysis',
                            'mimeType': gws.SHEET,
                            'parents': ['f0001']
                        })
                        created = await trial.exec(
                            'gws drive files create --json ' +
                            shlex.quote(new_file))
                        self.assertEqual(created.return_code, 0,
                                         created.stderr)
                        sheet_id = json.loads(created.stdout)['id']
                        line = (f'gws sheets write --spreadsheet {sheet_id} '
                                f'--range Sheet1!A1 --json-values '
                                ) + shlex.quote(json.dumps(rows))
                        updated = await trial.exec(line)
                        self.assertEqual(updated.return_code, 0,
                                         updated.stderr)
                    elif name in {
                            'sync-todo-to-readme', 'personal-website-construct'
                    }:
                        await github_oracle(self, task, trial)
                    elif name in toolathlon.OUTPUT_TREES:
                        make_directory_oracle(task, trial)
                    else:
                        truth = next(key for key in toolathlon.INPUTS[name]
                                     if '/groundtruth_workspace/' in key)
                        await trial.workspace.vfs.write(
                            '/workspace/' + toolathlon.OUTPUTS[name],
                            task.file(truth).read_bytes())
                    self.assertEqual((await trial.verify()).reward, 1)
                    if name == toolathlon.NHL:
                        state = await trial.service_state('gws')
                        self.assertTrue(
                            gws.result_rows(state, 'f0001',
                                            'NHL-B2B-Analysis'))
                        state['files'].clear()
                        self.assertTrue((await
                                         trial.service_state('gws'))['files'])
                    elif name in toolathlon.github.FIXTURE_HASHES:
                        self.assertTrue(
                            (await
                             trial.service_state('github'))['repositories'])


async def cloud_command(case, trial, name, args=None):
    command = 'google-cloud ' + name
    if args is not None:
        command += ' ' + shlex.quote(json.dumps(args))
    result = await trial.exec(command)
    case.assertEqual(result.return_code, 0, result.stderr + result.stdout)
    return result.stdout.strip()


async def submit_log(case, trial, message):
    log = await cloud_command(case, trial, 'logging-list-logs')
    await cloud_command(case, trial, 'logging-write-log', {
        'log_name': log,
        'message': message,
        'severity': 'CRITICAL'
    })


async def logging_oracle(case, task, trial):
    dataset = toolathlon.bigquery.WAREHOUSES[task.id]
    meta = json.loads(await
                      cloud_command(case, trial, 'bigquery-get-dataset-info',
                                    {'dataset_id': dataset}))
    case.assertEqual(len(meta['tables']), {
        'ab-testing': 20,
        'academic-warning': 7,
        'live-transactions': 10
    }[task.id])
    if task.id == 'ab-testing':
        records = task.file(
            'upstream/groundtruth_workspace/expected_ratio.csv').read_bytes()
        await trial.workspace.vfs.write('/workspace/record.csv', records)
        await cloud_command(case, trial, 'storage-create-bucket',
                            {'bucket_name': 'promo-assets-for-b-trial'})
    elif task.id == 'academic-warning':
        data = task.file('upstream/groundtruth_workspace/expected_alerts.csv'
                         ).read_text(encoding='utf-8-sig')
        reader = csv.DictReader(io.StringIO(data))
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=reader.fieldnames)
        writer.writeheader()
        for row in reader:
            if float(row['drop_ratio']) > 0.25:
                writer.writerow(row)
            if float(row['drop_ratio']) > 0.45:
                await submit_log(case, trial,
                                 row['student_id'] + ' ' + row['name'])
        await trial.workspace.vfs.write('/workspace/bad_student.csv',
                                        output.getvalue().encode())
    else:
        truth = task.file(
            'upstream/groundtruth_workspace/T8492XJ3_investigation_report.json'
        )
        await trial.workspace.vfs.write('/workspace/report.json',
                                        truth.read_bytes())
        bucket = (await
                  cloud_command(case, trial,
                                'storage-list-buckets')).removeprefix('- ')
        await cloud_command(
            case, trial, 'storage-upload-file', {
                'bucket_name': bucket,
                'source_file_path': '/workspace/report.json',
                'destination_blob_name': 'T8492XJ3.json'
            })
        await submit_log(
            case, trial,
            json.dumps({
                'alert_type': 'Fraud',
                'transaction_id': 'T8492XJ3',
                'status': 'Pending_Investigation'
            }))
    if task.id != 'ab-testing':
        state = await trial.service_state('logging')
        case.assertTrue(state['entries'])
        case.assertTrue(all('textPayload' in row for row in state['entries']))


def make_directory_oracle(task, trial):
    root = trial.run_dir / 'workspace'
    if task.id == 'arrange-workspace':
        # This upstream evaluator compares the names and types of every entry.
        tree = ast.parse(
            task.file('upstream/evaluation/check_local.py').read_text())
        structure = next(
            ast.literal_eval(node.value) for node in tree.body
            if isinstance(node, ast.Assign) and any(
                isinstance(name, ast.Name) and name.id == 'GT_STRUCTURE'
                for name in node.targets))
        original = trial.run_dir / 'original-inputs'
        original.mkdir()
        for child in root.iterdir():
            child.rename(original / child.name)
        for name in structure['directories']:
            (root / name).mkdir(parents=True, exist_ok=True)
        for name in structure['files']:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).touch()
    elif task.id == 'courses-ta-hws':
        mapping = json.loads(
            task.file('upstream/groundtruth_workspace/expected_mapping.json').
            read_bytes())
        output = root / 'os_hw3'
        for student in mapping['expected_students'].values():
            target = output / student['target_folder'] / student[
                'expected_renamed']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((root / student['original_file']).read_bytes())
        return output
    else:
        key = next(n for n in toolathlon.INPUTS[task.id]
                   if n.startswith('upstream/groundtruth_workspace/'))
        with tarfile.open(task.file(key)) as archive:
            archive.extractall(root, filter='data')


async def github_oracle(case, task, trial):

    async def api(method, path, payload=None):
        command = f'gh api -X {method} ' + shlex.quote(path)
        if payload is not None:
            await trial.workspace.vfs.write('/workspace/patch.json',
                                            json.dumps(payload).encode())
            command += ' --input /workspace/patch.json'
        result = await trial.exec(command)
        case.assertEqual(result.return_code, 0, result.stderr)
        return json.loads(result.stdout)

    async def put(repo, ref, path, content):
        route = 'repos/' + repo + '/contents/' + path
        current = await api('GET', route + '?ref=' + ref)
        await api(
            'PUT', route, {
                'branch': ref,
                'message': 'Update ' + path,
                'sha': current['sha'],
                'content': base64.b64encode(content).decode()
            })

    if task.id == 'sync-todo-to-readme':
        readme = task.file(
            'upstream/groundtruth_workspace/README.md').read_bytes()
        await put('integ-user/LUFFY', 'dev', 'README.md', readme)
    else:
        fork = await api('POST',
                         'repos/academicpages/academicpages.github.io/forks',
                         {'name': 'LJT-Homepage'})
        if fork['name'] != 'LJT-Homepage':
            await api('PATCH', 'repos/' + fork['full_name'],
                      {'name': 'LJT-Homepage'})
        memory = task.file(
            'upstream/initial_workspace/memory/memory.json').read_text()
        person = next(
            json.loads(line) for line in memory.splitlines()
            if json.loads(line).get('entityType') == 'Person')
        observations = person['observations']
        email = next(
            s.split(': ', 1)[1] for s in observations
            if s.startswith('Email: '))
        handle = next(
            s.split(': ', 1)[1].split(' ')[0] for s in observations
            if s.startswith('GitHub: '))
        config = json.dumps({
            'author': {
                'name': person['name'],
                'email': email,
                'github': handle
            }
        }).encode()
        await put('integ-user/LJT-Homepage', 'master', '_config.yml', config)
        await put('integ-user/LJT-Homepage', 'master', '_pages/about.md',
                  memory.encode())
