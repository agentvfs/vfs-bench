"""Freeze DataSpace bytes and file metadata; scoring happens only in Monty."""
import hashlib
import json
import stat
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'manifest.json'
MAX_CSV_BYTES = 20 * 1024 * 1024  # reference limit; don't stage larger files
PREDICTION = '/output/prediction.csv'


def definitions():
    return json.loads(MANIFEST.read_text())['tasks']


async def freeze(verifier, definition, stage, budget):

    def snapshot(budget):
        task_id = definition['task_id']
        files = {}
        for name, virtual, expected in (
            ('config.json',
             f'/opt/dataspace-evaluation/configs/{task_id}.json',
             definition['config_sha256']),
            ('gold.csv', '/opt/dataspace-evaluation/gold/gold.csv',
             definition['gold_sha256']),
        ):
            data = b''.join(budget.chunks(verifier.inputs_dir / name))
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(
                    f'DataSpace {name} changed; regenerate the task')
            target = stage / f'reference-{len(files)}'
            target.write_bytes(data)
            target.chmod(0o400)
            files[virtual] = str(target)
        path = verifier.environment.host_path(PREDICTION)
        roots = [
            p.resolve() for p in verifier.environment.disk_mounts.values()
        ]
        if not any(path.parent.resolve().is_relative_to(root)
                   for root in roots):
            raise ValueError('DataSpace prediction leaves its workspace mount')
        info = {'task_id': task_id, 'kind': 'missing', 'size': 0}
        if path.is_symlink():
            if not any(path.resolve().is_relative_to(root) for root in roots):
                raise ValueError(
                    'DataSpace symlink leaves its workspace mount')
            if path.exists():
                info['kind'] = 'symlink' if path.is_file() else 'directory'
        elif path.exists():
            details = path.stat()
            info.update(
                kind='file' if stat.S_ISREG(details.st_mode) else 'directory',
                size=details.st_size)
            if info['kind'] == 'file' and info['size'] <= MAX_CSV_BYTES:
                target = stage / 'prediction.csv'
                budget.copy(path, target)
                files[PREDICTION] = str(target)
        target = stage / 'status.json'
        budget.write_json(target, info)
        target.chmod(0o400)
        files['/.verifier-input/status.json'] = str(target)
        return {'states': {}, 'files': files}

    return await verifier._background(snapshot, budget=budget)
