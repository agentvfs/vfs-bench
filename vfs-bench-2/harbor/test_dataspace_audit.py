"""Saved submission replay must preserve the original grading outcome.

    python3.12 -I harbor/test_dataspace_audit.py
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_dataspace as audit  # noqa: E402


class DataSpaceAuditTests(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.job = self.root / 'job'
        self.config = self.state / 'benchmark/evaluation/configs/task_33.json'
        self.config.parent.mkdir(parents=True)
        self.config.write_text(
            json.dumps({
                'schema_version':
                '1.0',
                'task_id':
                'task_33',
                'order_sensitive':
                False,
                'columns': [{
                    'gold_index': 0,
                    'gold_name': 'v',
                    'type': 'text'
                }],
            }))
        self.gold = self.state / 'benchmark/output/task_33/gold.csv'
        self.gold.parent.mkdir(parents=True)
        self.gold.write_bytes(b'v\na\n')
        source = self.state / 'evaluation/evaluate.py'
        source.parent.mkdir(parents=True)
        source.write_bytes(
            (audit.HARBOR /
             'graders/dataspace/reference/evaluate.py').read_bytes())
        self.predictions = {}
        for kind in ('file', 'symlink', 'directory', 'missing',
                     'dangling-link', 'directory-link', 'oversize'):
            trial = self.job / kind
            path = trial / 'mirage/output/prediction.csv'
            path.parent.mkdir(parents=True)
            (trial / 'result.json').write_text(
                json.dumps({'task_name': 'fund-ytd-returns'}))
            if kind == 'file':
                path.write_bytes(self.gold.read_bytes())
            elif kind == 'symlink':
                path.symlink_to(self.gold)
            elif kind == 'directory':
                path.mkdir()
            elif kind == 'dangling-link':
                path.symlink_to(self.root / 'absent')
            elif kind == 'directory-link':
                path.symlink_to(self.gold.parent)
            elif kind == 'oversize':
                with path.open('wb') as handle:
                    handle.truncate(audit.MAX_CSV_BYTES + 123)
            self.predictions[kind] = path

    def test_rejected_submissions_are_not_read_or_dereferenced(self):
        kinds = {
            'symlink': 'symlink',
            'directory': 'directory',
            'directory-link': 'directory',
            'missing': 'missing',
            'dangling-link': 'missing',
            'oversize': 'file',
        }
        with patch.object(
                Path,
                'read_bytes',
                side_effect=AssertionError(
                    'Rejected submission contents must not be read')):
            for name, kind in kinds.items():
                with self.subTest(name=name):
                    data, info = audit.saved_prediction(self.predictions[name])
                    self.assertIsNone(data)
                    self.assertEqual(info['kind'], kind)
                    if name == 'oversize':
                        self.assertEqual(info['size'],
                                         audit.MAX_CSV_BYTES + 123)
        data, info = audit.saved_prediction(self.predictions['file'])
        self.assertEqual(data, b'v\na\n')
        self.assertEqual(info, {'kind': 'file', 'size': 4})

    def test_deleted_workspace_is_not_replayed_as_missing_prediction(self):
        self.predictions['missing'].parent.rmdir()
        args = SimpleNamespace(replay_only=True, jobs=[self.job])
        manifest = {'tasks': {'fund-ytd-returns': {'task_id': 'task_33'}}}
        with patch.object(audit, 'STATE', self.state):
            with self.assertRaisesRegex(FileNotFoundError, '--no-delete'):
                list(audit.inputs(manifest, args))

    @unittest.skipUnless(sys.version_info[:2] == (3, 12),
                         'The reference grader uses CPython 3.12')
    def test_replay_matches_original_paths_in_reference_and_monty(self):
        report = self.root / 'report.json'
        args = [
            'audit', '--replay-only', '--jobs',
            str(self.job), '--output',
            str(report)
        ]
        with (patch.object(audit, 'STATE',
                           self.state), patch.object(sys, 'argv', args),
              contextlib.redirect_stdout(io.StringIO())):
            audit.main()
        result = json.loads(report.read_text())
        self.assertEqual(result['comparisons'], 7)
        self.assertEqual(result['mismatches'], 0)
        reference = sys.modules['reference_dataspace']
        for row in result['results']:
            name = row['case'].rsplit('/', 1)[-1]
            path = self.predictions[name]
            expected = reference.evaluate_task(
                config=reference.load_task_config(self.config),
                prediction_path=path,
                gold_path=self.gold).to_dict()
            if expected['error']:
                expected['error'] = expected['error'].replace(
                    str(path), '/output/prediction.csv')
            with self.subTest(name=name):
                self.assertEqual(row['reference'], expected)
                self.assertEqual(row['native'], expected)
                self.assertEqual(expected['score'], int(name == 'file'))
                if name == 'symlink':
                    self.assertIn('Symbolic links are not allowed',
                                  expected['error'])
                elif name in ('directory', 'directory-link'):
                    self.assertIn('not a regular file', expected['error'])
                elif name == 'oversize':
                    self.assertIn(str(audit.MAX_CSV_BYTES + 123),
                                  expected['error'])


if __name__ == '__main__':
    unittest.main()
