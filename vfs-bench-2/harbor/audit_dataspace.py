"""Compare frozen DataSpace inputs with the pinned CPython evaluator.

Run with CPython 3.12: python -I harbor/audit_dataspace.py --output REPORT
Only this audit executes CPython grading; the production port never calls it.
"""
import argparse
import base64
import csv
import hashlib
import importlib.util
import io
import json
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
STATE = ROOT / 'state/dataspace'
MAX_CSV_BYTES = 20 * 1024 * 1024  # pinned evaluator's input limit


def csv_bytes(rows):
    output = io.StringIO(newline='')
    csv.writer(output, lineterminator='\n').writerows(rows)
    return output.getvalue().encode()


def cases(manifest):
    for task, definition in manifest['tasks'].items():
        task_id = definition['task_id']
        config = (STATE /
                  f'benchmark/evaluation/configs/{task_id}.json').read_bytes()
        gold = (STATE / f'benchmark/output/{task_id}/gold.csv').read_bytes()
        rows = list(
            csv.reader(io.StringIO(gold.decode('utf-8-sig'), newline='')))
        for name, prediction in (
            ('gold', gold),
            ('missing', None),
            ('empty', b''),
            ('header', csv_bytes(rows[:1])),
            ('bom', b'\xef\xbb\xbf' + gold),
            ('reverse_columns',
             csv_bytes([list(reversed(row)) for row in rows])),
            ('reverse_rows', csv_bytes([rows[0], *reversed(rows[1:])])),
            ('duplicate_row', csv_bytes([*rows, rows[-1]])),
            ('extra_column', csv_bytes([row + ['extra'] for row in rows])),
            ('nul', b'head\n\x00\n'),
            ('bad_quote', b'head\n"unterminated'),
            ('bad_utf8', b'head\n\xff\n'),
        ):
            yield task, name, config, gold, prediction, None
    # Exercise every evaluator type with small explicit synthetic configs.
    task = 'fund-ytd-returns'
    for column, values in (
        ({
            'type': 'text'
        }, ['e\u0301', 'é', '\u0085é\u001c', 'É', '', 'null', '"x"',
            'a\r\nb']),
        ({
            'type': 'number',
            'comparison': {
                'mode': 'decimal_places',
                'digits': 4
            }
        }, [
            '1.23445', '1.234450', '1.2344499999', '1.2345', '1.2344',
            '-1.23445', '١.٢٣٤٤٥', '１２.３', '1_000', 'nan',
            '1e999999999999999999999'
        ]),
        ({
            'type': 'number',
            'comparison': {
                'mode': 'significant_digits',
                'digits': 12
            }
        }, [
            '1234567890.12345', '1,234,567,890.12345', '1234567890.1235',
            '1234567890.1299', '001234567890.12345', '1e-1000', '-0',
            'Infinity'
        ]),
        ({
            'type': 'number',
            'comparison': {
                'mode': 'integer'
            }
        }, ['123', '123.0', '1.23e2', '１２３', '١٢٣', '123.1', '1,23', 'null']),
        ({
            'type': 'number',
            'comparison': {
                'mode': 'decimal_places',
                'digits': 10
            },
            'allow_percent_sign': True,
            'unit': 'fraction'
        }, ['12.5%', '0.125', '12.5000000001%', '12.6%', '12.5%%']),
        ({
            'type': 'date'
        }, [
            '2020-01-01', '20200101', '2020-W01-3',
            '2020-01-01T02:00:00+02:00', '2020-01-01T00:00:01', '2020-02-30',
            'nat'
        ]),
        ({
            'type': 'datetime'
        }, [
            '2020-01-01T00:00:00Z', '2020-01-01T02:00:00+02:00',
            '20200101T000000+0000', '2020-01-01', 'invalid'
        ]),
        ({
            'type': 'boolean'
        }, ['true', 'TRUE', 'yes', '是', '1', 'false', 'invalid', '<NA>']),
    ):
        config = json.dumps({
            'schema_version':
            '1.0',
            'task_id':
            'task_33',
            'order_sensitive':
            False,
            'columns': [{
                'gold_index': 0,
                'gold_name': 'value',
                **column
            }]
        }).encode()
        gold = csv_bytes([['value'], [values[0]]])
        for i, value in enumerate(values):
            mode = column.get('comparison', {}).get('mode', '')
            name = f"normalize-{column['type']}-{column.get('unit', '')}"
            yield (task, f'{name}-{mode}-{i}', config, gold,
                   csv_bytes([['renamed'], [value]]), None)
    config = json.dumps({
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
        }]
    }).encode()
    for name, prediction in [
        ('field-128k', b'v\n' + b'a' * 140000 + b'\n'),
        ('field-limit', b'v\n' + b'a' * (2 * 1024 * 1024) + b'\n'),
        ('field-too-long', b'v\n' + b'a' * (2 * 1024 * 1024 + 1) + b'\n')
    ]:
        gold = prediction if name != 'field-too-long' else b'v\na\n'
        yield task, name, config, gold, prediction, None
    for name, prediction in (
        ('row-limit', b'v\n' + b'a\n' * 100000),
        ('too-many-rows', b'v\n' + b'a\n' * 100001),
        ('too-many-columns', b','.join([b'v'] * 65) + b'\n'),
    ):
        yield task, name, config, b'v\na\n', prediction, None
    for name, changed_config, gold in (
        ('invalid-config', b'{}', b'v\na\n'),
        ('invalid-gold', config, b'v\n"unterminated'),
        ('invalid-gold-missing-prediction', config, b'v\n"unterminated'),
    ):
        prediction = None if name.endswith('prediction') else b'v\na\n'
        yield task, name, changed_config, gold, prediction, None
    for kind in ('directory', 'symlink', 'missing'):
        yield (task, 'path-' + kind, config, b'v\na\n', None, {
            'kind': kind,
            'size': 0
        })


def saved_prediction(path):
    """Freeze grading-relevant metadata without reading rejected inputs.

    The reference checks existence, regular-file status and symlinks before
    size or contents. A dangling link is missing; a link to a directory is
    non-regular. Match those categories, as the live native freezer does.
    """
    if not path.parent.is_dir():
        raise FileNotFoundError(
            f'Saved output mount is unavailable: {path.parent}; '
            'retain the workspace with --no-delete before replaying')
    try:
        details = path.stat()
    except FileNotFoundError:
        return None, {'kind': 'missing', 'size': 0}
    if not stat.S_ISREG(details.st_mode):
        kind = 'directory'
    elif path.is_symlink():
        kind = 'symlink'
    else:
        kind = 'file'
    info = {'kind': kind, 'size': details.st_size}
    data = None
    if kind == 'file' and details.st_size <= MAX_CSV_BYTES:
        data = path.read_bytes()
        if len(data) != details.st_size:
            raise ValueError(f'Saved prediction changed while reading: {path}')
    return data, info


def restore_prediction(path, data, status):
    """Recreate the reference's file checks, including rejected file sizes."""
    kind = status['kind']
    if kind == 'directory':
        path.mkdir()
    elif kind in ('file', 'symlink'):
        target = path
        if kind == 'symlink':
            target = path.with_name('symlink-target.csv')
            path.symlink_to(target)
        with target.open('wb') as handle:
            if data is not None:
                handle.write(data)
            # Oversized files need only their size, not a copy of the bytes.
            handle.truncate(status['size'])
    elif kind != 'missing':
        raise ValueError(f'Unknown prediction kind: {kind}')


def inputs(manifest, args):
    if not args.replay_only:
        yield from cases(manifest)
    for job in args.jobs:
        for result in sorted(job.glob('*/result.json')):
            task = json.loads(result.read_text())['task_name']
            if task not in manifest['tasks']:
                continue
            task_id = manifest['tasks'][task]['task_id']
            config = (
                STATE /
                f'benchmark/evaluation/configs/{task_id}.json').read_bytes()
            gold = (STATE /
                    f'benchmark/output/{task_id}/gold.csv').read_bytes()
            prediction = result.parent / 'mirage/output/prediction.csv'
            data, info = saved_prediction(prediction)
            yield (task, f'saved-{job.name}/{result.parent.name}', config,
                   gold, data, info)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--jobs', nargs='*', type=Path, default=[])
    parser.add_argument('--replay-only', action='store_true')
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        parser.error('Use CPython 3.12, matching the preserved reference VM')
    manifest = json.loads(
        (HARBOR / 'graders/dataspace/manifest.json').read_text())
    source = STATE / 'evaluation/evaluate.py'
    assert hashlib.sha256(
        source.read_bytes()).hexdigest() == manifest['reference_sha256']
    spec = importlib.util.spec_from_file_location('reference_dataspace',
                                                  source)
    evaluator = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = evaluator
    spec.loader.exec_module(evaluator)
    report = []
    process = subprocess.Popen(
        ['node', '--no-warnings',
         str(HARBOR / 'dataspace_replay.ts')],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        cwd=ROOT)
    try:
        for (task, label, config_bytes, gold_bytes, prediction,
             metadata) in inputs(manifest, args):
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                task_id = manifest['tasks'][task]['task_id']
                config = root / f'{task_id}.json'
                config.write_bytes(config_bytes)
                gold = root / 'gold.csv'
                gold.write_bytes(gold_bytes)
                pred = root / 'prediction.csv'
                status = {
                    'kind': 'missing' if prediction is None else 'file',
                    'size': len(prediction or b''),
                    **(metadata or {}),
                    'task_id': task_id,
                }
                restore_prediction(pred, prediction, status)
                try:
                    reference = evaluator.evaluate_task(
                        config=evaluator.load_task_config(config),
                        prediction_path=pred,
                        gold_path=gold).to_dict()
                    if reference['error']:
                        reference['error'] = reference['error'].replace(
                            str(pred), '/output/prediction.csv')
                except Exception as error:
                    reference = {'fatal': type(error).__name__}
                files = {
                    f'/opt/dataspace-evaluation/configs/{task_id}.json':
                    config_bytes,
                    '/opt/dataspace-evaluation/gold/gold.csv': gold_bytes,
                    '/.verifier-input/status.json':
                    json.dumps(status).encode()
                }
                if prediction is not None:
                    files['/output/prediction.csv'] = prediction
                request = {
                    'task': task,
                    'timeoutSeconds': 60,
                    'files': {
                        k: base64.b64encode(v).decode()
                        for k, v in files.items()
                    }
                }
                process.stdin.write(json.dumps(request) + '\n')
                process.stdin.flush()
                answer = json.loads(process.stdout.readline())
                native = answer.get('result',
                                    {}).get('artifacts',
                                            {}).get('evaluation.json')
                if 'fatal' in reference:
                    fatal_type = {
                        'EvaluationFatalError': 'RuntimeError',
                        'PredictionFormatError': 'ValueError',
                        'CellNormalizationError': 'TypeError',
                    }.get(reference['fatal'], reference['fatal'])
                    matched = fatal_type + ':' in answer.get('error', '')
                else:
                    matched = native == reference
                report.append({
                    'task': task,
                    'case': label,
                    'matched': matched,
                    'reference': reference,
                    'native': native or answer
                })
                print(
                    f"{task}/{label}: {'matched' if matched else 'MISMATCH'}",
                    flush=True)
                if not matched:
                    print(json.dumps(report[-1], ensure_ascii=False),
                          flush=True)
    finally:
        process.stdin.close()
        process.wait(timeout=20)
        process.stdout.close()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(
                {
                    'comparisons': len(report),
                    'mismatches': sum(not x['matched'] for x in report),
                    'results': report
                },
                indent=2) + '\n')
    if not report or any(not x['matched'] for x in report):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
